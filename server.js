// server.js - Servidor WebSocket para Twilio ConversationRelay
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuração do servidor
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Diretório para logs
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Função para log detalhado
function logEvent(type, data) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${type}: ${JSON.stringify(data)}`;
  console.log(logMessage);
  
  // Salvar logs em arquivo com data
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(logsDir, `conversation_relay_${today}.log`);
  fs.appendFileSync(logFile, logMessage + '\n');
}

// Inicialização do servidor
const startTime = new Date();
logEvent('SERVER_START', { timestamp: startTime.toISOString() });

// Gerenciar conexões WebSocket
wss.on('connection', (ws, req) => {
  // Extrair callSid da URL de consulta (se disponível)
  const url = new URL('http://localhost' + req.url);
  const callSid = url.searchParams.get('callSid');
  
  logEvent('CONNECTION', { 
    url: req.url, 
    callSid,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
  
  // Manter conexão ativa com heartbeat
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logEvent('HEARTBEAT', { callSid, timestamp: new Date().toISOString() });
    }
  }, 25000);
  
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      logEvent('RECEIVED', msg);
      
      // 1. Evento 'connected' - Handshake inicial
      if (msg.event === 'connected') {
        const response = { event: 'connected' };
        logEvent('SENDING', response);
        ws.send(JSON.stringify(response));
      }
      
      // 2. Evento 'start' - Início da chamada
      if (msg.event === 'start') {
        const response = {
          event: 'speak',
          text: 'Olá! Aqui é a Voxemy. Como posso ajudar você hoje?',
          config: {
            provider: 'elevenlabs',
            voice_id: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', // Voz em português brasileiro
            stability: 0.35,
            similarity: 0.75,
            style: 0.4,
            speed: 0.95,
            audio_format: 'ulaw_8000' // Formato telefônico obrigatório
          }
        };
        logEvent('SENDING', response);
        ws.send(JSON.stringify(response));
      }
      
      // 3. Evento 'media' - Áudio do usuário
      if (msg.event === 'media') {
        logEvent('MEDIA', { received: true, length: msg.media?.length || 0 });
        // Processar áudio se necessário
      }
      
      // 4. Evento 'transcript' - Transcrição do áudio
      if (msg.event === 'transcript' && msg.transcript) {
        logEvent('TRANSCRIPT', { speech: msg.transcript.speech });
        
        // Processar com IA e enviar resposta
        const resposta = await processarComIA(msg.transcript.speech);
        
        const response = {
          event: 'speak',
          text: resposta,
          config: {
            provider: 'elevenlabs',
            voice_id: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
            stability: 0.35,
            similarity: 0.75,
            style: 0.4,
            speed: 0.95,
            audio_format: 'ulaw_8000'
          }
        };
        
        logEvent('SENDING', response);
        ws.send(JSON.stringify(response));
      }
      
      // 5. Evento 'mark' - Marcadores de progresso
      if (msg.event === 'mark') {
        logEvent('MARK', { mark: msg.mark });
        // Não requer resposta
      }
      
      // 6. Evento 'stop' - Fim da chamada
      if (msg.event === 'stop') {
        logEvent('STOP', { reason: msg.reason });
        clearInterval(interval);
        ws.close();
      }
      
    } catch (error) {
      logEvent('ERROR', { message: error.message, stack: error.stack });
    }
  });
  
  ws.on('close', () => {
    logEvent('CLOSE', { callSid });
    clearInterval(interval);
  });
  
  ws.on('error', (error) => {
    logEvent('ERROR', { message: error.message });
    clearInterval(interval);
  });
});

// Função para processar com IA (substitua pela sua implementação)
async function processarComIA(texto) {
  logEvent('AI_PROCESSING', { input: texto });
  
  try {
    // Se estiver configurada uma API de IA externa
    if (process.env.AI_API_URL) {
      const response = await axios.post(process.env.AI_API_URL, {
        input: texto,
        callerId: process.env.CALLER_ID || 'voxemy'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.AI_API_KEY || ''}`
        }
      });
      
      return response.data.response || "Desculpe, não consegui processar sua solicitação.";
    }
    
    // Implementação simples de fallback
    if (texto.toLowerCase().includes('olá') || texto.toLowerCase().includes('oi')) {
      return "Olá! Como posso ajudar você hoje?";
    } else if (texto.toLowerCase().includes('ajuda')) {
      return "Estou aqui para ajudar. O que você precisa?";
    } else if (texto.toLowerCase().includes('tchau') || texto.toLowerCase().includes('adeus')) {
      return "Foi um prazer conversar com você. Até a próxima!";
    } else {
      return "Entendi sua mensagem. Como posso ajudar com isso?";
    }
  } catch (error) {
    logEvent('AI_ERROR', { message: error.message, stack: error.stack });
    return "Desculpe, estou com dificuldades para processar sua solicitação no momento.";
  }
}

// Rota de health check
app.get('/health', (req, res) => {
  const uptime = Math.floor((new Date() - startTime) / 1000);
  res.status(200).send({ 
    status: 'ok', 
    uptime: `${uptime} segundos`,
    connections: wss.clients.size,
    timestamp: new Date().toISOString() 
  });
});

// Rota de status
app.get('/status', (req, res) => {
  const uptime = Math.floor((new Date() - startTime) / 1000);
  const connections = wss.clients.size;
  
  res.status(200).send({
    status: 'ok',
    uptime: `${uptime} segundos`,
    connections,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Rota principal
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Voxemy WebSocket Server</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          .status { padding: 10px; background-color: #f0f0f0; border-radius: 5px; }
          .success { color: green; }
        </style>
      </head>
      <body>
        <h1>Voxemy WebSocket Server</h1>
        <div class="status">
          <p><strong>Status:</strong> <span class="success">Online</span></p>
          <p><strong>Uptime:</strong> ${Math.floor((new Date() - startTime) / 1000)} segundos</p>
          <p><strong>Conexões ativas:</strong> ${wss.clients.size}</p>
          <p><strong>Versão:</strong> ${process.env.npm_package_version || '1.0.0'}</p>
        </div>
        <p>Este servidor está configurado para processar conexões WebSocket do Twilio ConversationRelay.</p>
      </body>
    </html>
  `);
});

// Iniciar o servidor
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Servidor WebSocket iniciado na porta ${PORT}`);
  logEvent('SERVER_LISTENING', { port: PORT });
});
