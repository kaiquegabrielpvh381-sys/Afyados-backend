const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURAÇÃO OPENROUTER
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// SEU PROMPT OFICIAL AFYADOS (O CÉREBRO)
const AFYADOS_PROMPT = `
[COLE AQUI O TEXTO DO SEU PROMPT OFICIAL QUE VOCÊ ME MANDOU ANTES]

IMPORTANTE PARA O SITE:
1. Use SEMPRE Markdown (### Títulos e **Negrito**).
2. IMAGENS: Para cada tópico, busque e insira uma imagem relevante da WIKIPEDIA ou WIKIMEDIA usando: ![Descrição](Link_da_Imagem).
3. ESPAÇAMENTO: Use quebras de linha duplas entre os parágrafos para o texto fluir bem no site.
`;

app.post('/chat', async (req, res) => {
    const { messages } = req.body;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "anthropic/claude-3.5-sonnet", // O "Doutor" das IAs
                "messages": [
                    { "role": "system", "content": AFYADOS_PROMPT },
                    ...messages
                ],
                "stream": true // Streaming para ser instantâneo
            })
        });

        // Configuração para enviar o texto em tempo real (Streaming)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6);
                    if (data === "[DONE]") break;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content || "";
                        res.write(content); // Envia pro seu ia.html
                    } catch (e) {}
                }
            }
        }
        res.end();

    } catch (error) {
        console.error("Erro OpenRouter:", error);
        res.status(500).send("Erro na conexão com o fornecedor de IA.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Distribuidor Afyados rodando na porta ${PORT}`));
