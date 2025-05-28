# Voxemy WebSocket Server para Twilio ConversationRelay

Este repositório contém um servidor WebSocket dedicado para integração com Twilio ConversationRelay, permitindo chamadas telefônicas automatizadas com voz de alta qualidade usando ElevenLabs.

## Características

- Implementação completa do protocolo Twilio ConversationRelay
- Integração com ElevenLabs para voz de alta qualidade em português brasileiro
- Sistema de logs detalhados para diagnóstico
- Rotas de health check e status
- Pronto para deploy na Railway

## Requisitos

- Node.js 18 ou superior
- Conta na Railway para deploy
- Conta no Twilio com ConversationRelay habilitado
- Conta no ElevenLabs para síntese de voz

## Configuração Local

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/voxemy-websocket-server.git
cd voxemy-websocket-server
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
# Edite o arquivo .env com suas credenciais
```

4. Inicie o servidor:
```bash
npm start
```

## Deploy na Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/voxemy-websocket-server)

1. Clique no botão acima para iniciar o deploy na Railway
2. Configure as variáveis de ambiente necessárias:
   - `ELEVENLABS_API_KEY`: Sua chave de API do ElevenLabs
   - `ELEVENLABS_VOICE_ID`: ID da voz do ElevenLabs (padrão: pNInz6obpgDQGcFmaJgB para português brasileiro)

## Integração com Twilio

Configure o TwiML para apontar para seu servidor WebSocket:

```xml
<Response>
  <Connect>
    <ConversationRelay 
      url="wss://seu-servidor-websocket.railway.app/websocket?callSid={{CallSid}}" 
      transcriptionEnabled="true"
      transcriptionLanguage="pt-BR"
      detectSpeechTimeout="2"
      interruptByDtmf="true"
      dtmfInputs="#,*"
      ttsProvider="ElevenLabs"
      ttsVoice="pNInz6obpgDQGcFmaJgB"
      ttsLanguage="pt-BR"
    />
  </Connect>
</Response>
```

## Estrutura do Projeto

- `server.js`: Implementação principal do servidor WebSocket
- `package.json`: Dependências e scripts
- `.env.example`: Exemplo de variáveis de ambiente
- `logs/`: Diretório onde os logs são armazenados

## Protocolo ConversationRelay

O servidor implementa o protocolo completo do Twilio ConversationRelay:

1. Handshake inicial com evento `connected`
2. Resposta ao evento `start` com mensagem de boas-vindas
3. Processamento de eventos `media` e `transcript`
4. Resposta com evento `speak` usando ElevenLabs
5. Gerenciamento de eventos `mark` e `stop`

## Monitoramento

O servidor inclui endpoints para monitoramento:

- `/health`: Verificação básica de saúde do servidor
- `/status`: Informações detalhadas sobre o servidor, incluindo uptime e conexões ativas

## Licença

MIT
