const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

/**
 * Baixa a imagem do comprovante (URL do Twilio, exige autenticação básica)
 * e retorna o base64 + mime type.
 */
async function downloadTwilioMedia(mediaUrl) {
  const auth = {
    username: process.env.TWILIO_ACCOUNT_SID,
    password: process.env.TWILIO_AUTH_TOKEN,
  };
  const response = await axios.get(mediaUrl, { auth, responseType: 'arraybuffer' });
  const mimeType = response.headers['content-type'] || 'image/jpeg';
  const base64 = Buffer.from(response.data).toString('base64');
  return { base64, mimeType };
}

/**
 * Analisa a foto de um comprovante/nota fiscal e extrai os dados estruturados.
 */
async function analisarComprovante(mediaUrl, categoriasDisponiveis, contentTypeHint) {
  const { base64, mimeType: mimeTypeBaixado } = await downloadTwilioMedia(mediaUrl);

  // Preferimos o tipo que o próprio Twilio informou no webhook (mais confiável);
  // se não vier, usamos o que detectamos ao baixar o arquivo.
  const mimeType = contentTypeHint || mimeTypeBaixado;

  const listaCategorias = categoriasDisponiveis.map((c) => c.name).join(', ');

  // PDF usa o bloco "document"; fotos (jpeg/png/webp) usam o bloco "image"
  const isPdf = mimeType.toLowerCase().includes('pdf');
  const conteudoArquivo = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: [
          conteudoArquivo,
          {
            type: 'text',
            text: `Analise este comprovante/nota fiscal e responda APENAS com um JSON válido (sem markdown, sem texto extra), no formato:
{
  "valor": <número, valor total em reais>,
  "data": "<data no formato YYYY-MM-DD, ou null se não legível>",
  "estabelecimento": "<nome do estabelecimento/fornecedor, ou null>",
  "categoria_sugerida": "<uma das opções: ${listaCategorias}, a que melhor se encaixa>",
  "descricao": "<breve descrição do que foi comprado, 1 linha>"
}`,
          },
        ],
      },
    ],
  });

  const text = msg.content.find((b) => b.type === 'text')?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error('Falha ao parsear resposta da Claude API:', text);
    return { valor: null, data: null, estabelecimento: null, categoria_sugerida: null, descricao: null };
  }
}

/**
 * Interpreta uma mensagem de texto tipo "gastei 50 reais de combustível"
 * e extrai valor + categoria sugerida.
 */
async function interpretarTexto(mensagem, categoriasDisponiveis) {
  const listaCategorias = categoriasDisponiveis.map((c) => c.name).join(', ');

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `O usuário enviou esta mensagem sobre uma despesa: "${mensagem}"
Responda APENAS com um JSON válido (sem markdown), no formato:
{
  "valor": <número, ou null se não identificado>,
  "categoria_sugerida": "<uma das opções: ${listaCategorias}, ou null se não identificado>",
  "descricao": "<breve descrição, 1 linha>"
}`,
      },
    ],
  });

  const text = msg.content.find((b) => b.type === 'text')?.text || '{}';
  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error('Falha ao parsear resposta da Claude API:', text);
    return { valor: null, categoria_sugerida: null, descricao: mensagem };
  }
}

module.exports = { analisarComprovante, interpretarTexto };
