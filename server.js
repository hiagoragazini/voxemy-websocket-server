// Servidor WebSocket dedicado para Twilio ConversationRelay
// Template completo para implantação em Railway/Render

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

// Configuração do servidor
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Função para log detalhado
function logEvent(type, data) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${type}:`, JSON.stringify(data, null, 2));
}

// Sistema de prompt para IA
const systemPrompt = `Você é Laura, assistente virtual brasileira da Voxemy para atendimento telefônico.

INSTRUÇÕES CRÍTICAS:
- Seja natural, amigável e concisa (máximo 2 frases)
- Use português brasileiro coloquial para telefone
- Processe o que o cliente disse e responda adequadamente
- Se não entender, peça para repetir educadamente
- Mantenha a conversa fluindo naturalmente

Esta é uma conversa telefônica ao vivo em tempo real.`;

// Função para gerar resposta da IA
async function generateAIResponse(userText, conversationHistory = []) {
  if (!OPENAI_API_KEY) {
    return "Desculpe, estou com problemas técnicos no momento.";
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6),
        { role: 'user', content: userText }
      ],
      max_tokens: 100,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0]?.message?.content?.trim() || 
           "Desculpe, não entendi bem. Pode repetir?";
  } catch (error) {
    logEvent('AI_ERROR', { error: error.message });
    return "Desculpe, não entendi bem. Pode repetir?";
  }
}

// Gerenciar conexões WebSocket
wss.on('connection', (ws, req) => {
  // Inicializar callSid como null - será extraído do evento 'start'
  let callSid = null;
  
  try {
    // Log da tentativa de conexão com todos os headers para diagnóstico
    logEvent('CONNECTION_ATTEMPT', {
      url: req.url,
      host: req.headers.host,
      headers: req.headers,
      userAgent: req.headers['user-agent'],
      origin: req.headers.origin
    });
  } catch (error) {
    logEvent('CONNECTION_LOG_ERROR', {
      error: error.message,
      originalUrl: req.url,
      headers: req.headers
    });
  }
  
  // Gerar callSid temporário para debug até receber o real
  const tempCallSid = `TEMP_${Date.now()}`;
  callSid = tempCallSid;
  
  // Validação de origem Twilio
  const userAgent = req.headers['user-agent'] || '';
  const isTwilioAgent = userAgent.includes('TwilioProxy') || userAgent.includes('Twilio');
  
  if (!isTwilioAgent) {
    logEvent('WARNING_NON_TWILIO_CONNECTION', {
      callSid: tempCallSid,
      userAgent: userAgent,
      message: 'Conexão pode não ser do Twilio'
    });
  }
  
  logEvent('CONNECTION_ESTABLISHED', { 
    callSid: tempCallSid,
    isTwilioAgent: isTwilioAgent,
    activeConnections: wss.clients.size
  });
  
  let conversationHistory = [];
  let hasGreeted = false;
  
  // Heartbeat para manter conexão ativa
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logEvent('HEARTBEAT_SENT', { callSid });
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 25000);
  
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      logEvent('MESSAGE_RECEIVED', { 
        callSid, 
        event: msg.event, 
        hasData: !!msg.data,
        messageSize: message.length
      });
      
      // Extrair callSid do evento 'start' se disponível
      if (msg.event === 'start' && msg.start && msg.start.callSid) {
        callSid = msg.start.callSid;
        logEvent('CALLSID_EXTRACTED', { 
          callSid, 
          source: 'start_event',
          previousId: tempCallSid
        });
      }
      
      // Extrair callSid de qualquer outro campo que o Twilio possa enviar
      if (msg.callSid && !callSid.startsWith('TEMP_')) {
        callSid = msg.callSid;
        logEvent('CALLSID_EXTRACTED', { 
          callSid, 
          source: 'message_root',
          previousId: tempCallSid
        });
      }
      
      if (msg.call && msg.call.sid && !callSid.startsWith('TEMP_')) {
        callSid = msg.call.sid;
        logEvent('CALLSID_EXTRACTED', { 
          callSid, 
          source: 'call_object',
          previousId: tempCallSid
        });
      }
      
      switch (msg.event) {
        case 'connected':
          logEvent('HANDSHAKE_RECEIVED', { callSid });
          const response = { event: 'connected' };
          ws.send(JSON.stringify(response));
          logEvent('HANDSHAKE_SENT', { callSid, response });
          break;
          
        case 'start':
          logEvent('CALL_START', { 
            callSid, 
            streamSid: msg.start?.streamSid,
            fullStartObject: msg.start
          });
          
          if (!hasGreeted) {
            hasGreeted = true;
            const greeting = {
              event: 'speak',
              text: 'Olá! Aqui é a Laura da Voxemy. Como posso ajudar você hoje?',
              config: {
                provider: ELEVENLABS_API_KEY ? 'elevenlabs' : 'twilio',
                voice_id: 'FGY2WhTYpPnrIDTdsKH5',
                stability: 0.35,
                similarity: 0.75,
                style: 0.4,
                speed: 0.95,
                audio_format: 'ulaw_8000'
              }
            };
            
            if (!ELEVENLABS_API_KEY) {
              delete greeting.config.provider;
              delete greeting.config.voice_id;
              delete greeting.config.stability;
              delete greeting.config.similarity;
              delete greeting.config.style;
              delete greeting.config.speed;
            }
            
            ws.send(JSON.stringify(greeting));
            logEvent('GREETING_SENT', { callSid, greeting });
          }
          break;
          
        case 'media':
          // Log apenas a cada 50 pacotes de media para não poluir
          if (Math.random() < 0.02) { // ~2% dos pacotes
            logEvent('MEDIA_SAMPLE', { 
              callSid, 
              mediaLength: msg.media?.length || 0,
              timestamp: msg.media?.timestamp 
            });
          }
          break;
          
        case 'transcript':
          if (msg.transcript?.speech) {
            const userSpeech = msg.transcript.speech.trim();
            logEvent('TRANSCRIPT_RECEIVED', { 
              callSid, 
              speech: userSpeech,
              confidence: msg.transcript.confidence,
              isFinal: msg.transcript.is_final 
            });
            
            if (userSpeech.length > 2) {
              conversationHistory.push({ role: 'user', content: userSpeech });
              
              const aiResponse = await generateAIResponse(userSpeech, conversationHistory);
              
              if (aiResponse) {
                conversationHistory.push({ role: 'assistant', content: aiResponse });
                
                const speakEvent = {
                  event: 'speak',
                  text: aiResponse,
                  config: {
                    provider: ELEVENLABS_API_KEY ? 'elevenlabs' : 'twilio',
                    voice_id: 'FGY2WhTYpPnrIDTdsKH5',
                    stability: 0.35,
                    similarity: 0.75,
                    style: 0.4,
                    speed: 0.95,
                    audio_format: 'ulaw_8000'
                  }
                };
                
                if (!ELEVENLABS_API_KEY) {
                  delete speakEvent.config.provider;
                  delete speakEvent.config.voice_id;
                  delete speakEvent.config.stability;
                  delete speakEvent.config.similarity;
                  delete speakEvent.config.style;
                  delete speakEvent.config.speed;
                }
                
                ws.send(JSON.stringify(speakEvent));
                logEvent('AI_RESPONSE_SENT', { callSid, response: aiResponse });
              }
            }
          }
          break;
          
        case 'mark':
          logEvent('MARK_RECEIVED', { callSid, mark: msg.mark });
          break;
          
        case 'stop':
          logEvent('CALL_END', { 
            callSid, 
            reason: msg.reason,
            duration: conversationHistory.length 
          });
          clearInterval(heartbeatInterval);
          ws.close();
          break;
          
        default:
          logEvent('UNKNOWN_EVENT', { callSid, event: msg.event, data: msg });
          break;
      }
    } catch (error) {
      logEvent('MESSAGE_PARSE_ERROR', { 
        callSid, 
        error: error.message, 
        rawMessage: message.toString().substring(0, 200) + '...' 
      });
    }
  });
  
  ws.on('close', (code, reason) => {
    logEvent('CONNECTION_CLOSED', { 
      callSid, 
      code, 
      reason: reason?.toString(),
      activeConnections: wss.clients.size - 1
    });
    clearInterval(heartbeatInterval);
  });
  
  ws.on('error', (error) => {
    logEvent('WEBSOCKET_ERROR', { 
      callSid, 
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
    clearInterval(heartbeatInterval);
  });
  
  ws.on('pong', () => {
    logEvent('HEARTBEAT_PONG', { callSid });
  });
});

// Rotas HTTP para monitoramento
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connections: wss.clients.size,
    port: PORT,
    apis: {
      openai: !!OPENAI_API_KEY,
      elevenlabs: !!ELEVENLABS_API_KEY
    }
  });
});

app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'ok',
    connections: wss.clients.size,
    elevenlabs: !!ELEVENLABS_API_KEY,
    openai: !!OPENAI_API_KEY,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.get('/debug', (req, res) => {
  const connections = [];
  wss.clients.forEach((client, index) => {
    connections.push({
      index,
      readyState: client.readyState,
      protocol: client.protocol
    });
  });
  
  res.status(200).json({
    connections,
    totalConnections: wss.clients.size,
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: PORT
    }
  });
});

// Iniciar o servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor WebSocket Voxemy ATUALIZADO iniciado na porta ${PORT}`);
  console.log(`📊 APIs: OpenAI=${!!OPENAI_API_KEY}, ElevenLabs=${!!ELEVENLABS_API_KEY}`);
  console.log(`🌐 Endpoints: /health, /status, /debug`);
  console.log(`🔌 WebSocket pronto para Twilio ConversationRelay`);
  console.log(`🔧 Correções implementadas: Extração de callSid do payload, logs detalhados`);
});
