# MGM Financeiro — Lançamento de despesas via WhatsApp

Sistema de gestão financeira pessoal, da Fazenda e da MGM Assessoria Veterinária.
Duas pessoas lançam despesas/receitas direto pelo WhatsApp — por foto do comprovante ou por texto.

## Como funciona

1. Você (ou o administrativo) manda uma **foto** do comprovante ou um **texto** tipo
   `gastei 50 reais de combustível`.
2. O bot usa a Claude API pra ler o comprovante (valor, data, estabelecimento) ou interpretar o texto.
3. O bot pergunta, em sequência: **centro de custo** → **categoria** → **forma de pagamento**.
4. Você responde só com o número da opção.
5. O bot mostra um resumo, você confirma com `1`, e o lançamento é salvo no banco.
6. A qualquer momento, digitar `cancelar` interrompe o lançamento em andamento.

## Passo a passo para colocar no ar

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
Copie `.env.example` para `.env` e preencha:
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`: do painel da Twilio
- `TWILIO_WHATSAPP_NUMBER`: o número do WhatsApp Sandbox ou aprovado na Twilio
- `ANTHROPIC_API_KEY`: sua chave da API da Anthropic (console.anthropic.com)
- `AUTHORIZED_NUMBERS`: os dois números autorizados a lançar (você + administrativo),
  no formato `whatsapp:+55DDNNNNNNNNN`

### 3. Inicializar o banco de dados
```bash
npm run db:init
```
Isso cria `mgm.db` (SQLite) com os centros de custo, categorias e formas de pagamento padrão.

### 4. Cadastrar os dois usuários autorizados
Ainda não há tela para isso — cadastre direto no banco (uma vez só):
```bash
sqlite3 mgm.db "INSERT INTO users (phone, name, role) VALUES ('whatsapp:+5511999999999', 'Marcelo', 'owner');"
sqlite3 mgm.db "INSERT INTO users (phone, name, role) VALUES ('whatsapp:+5511888888888', 'Administrativo', 'admin');"
```

### 5. Subir o servidor
```bash
npm start
```
Isso levanta o servidor na porta definida em `.env` (padrão 3000).

### 6. Hospedar publicamente
O Twilio precisa de uma URL pública para enviar as mensagens (webhook). Opções simples:
- **Railway** ou **Render**: conecta o repositório e sobe automaticamente (recomendado)
- **Fly.io**: `fly launch` e `fly deploy`

Depois do deploy, pegue a URL pública, ex: `https://mgm-financeiro.up.railway.app`

### 7. Configurar o webhook na Twilio
No painel da Twilio → WhatsApp Sandbox (ou número aprovado) → campo "WHEN A MESSAGE COMES IN":
```
https://SEU-DOMINIO/webhook/whatsapp
```
Método: `HTTP POST`

### 8. Testar
Envie uma mensagem de teste pelo WhatsApp: `gastei 50 reais de combustível da fazenda`
ou mande uma foto de uma nota fiscal.

## Estrutura do projeto
```
mgm-financeiro/
├── server.js              # webhook + máquina de estados da conversa
├── db.js                  # conexão SQLite
├── schema.sql             # estrutura das tabelas + dados iniciais
├── services/
│   ├── claude.js          # leitura de comprovantes (OCR) e interpretação de texto
│   ├── twilio.js          # envio de mensagens
│   └── sessionState.js    # estado da conversa em andamento por telefone
└── .env.example
```

## Próximos passos sugeridos
- Painel web (dashboard) para visualizar lançamentos por centro de custo/período
- Exportar relatórios em Excel (por mês, por centro de custo)
- Editar/cadastrar categorias sem mexer direto no banco
- Migrar de SQLite para Postgres se o volume crescer muito
