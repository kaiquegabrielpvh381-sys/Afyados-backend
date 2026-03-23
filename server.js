const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// PROMPT OFICIAL AFYADOS - O DNA DO SEU NEGÓCIO
const AFYADOS_PROMPT = `
# **PROMPT OFICIAL — ENSINO MÉDICO AFYA | PBL | APG | MODO DIDÁTICO ADAPTATIVO**

[COLE AQUI TODO AQUELE SEU PROMPT OFICIAL DA AFYA]

DIRETRIZES TÉCNICAS PARA O SITE:
- Responda SEMPRE em Markdown.
- Use ### para títulos rosa e **negrito** para termos técnicos.
- IMAGENS: Para cada tópico, insira uma imagem didática usando: ![Descrição](Link_da_Imagem).
- Nunca grude as palavras. Use espaçamento duplo entre parágrafos.
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
                "model": "anthropic/claude-3.5-sonnet", // O melhor modelo para medicina
                "messages": [
                    { "role": "system", "content": AFYADOS_PROMPT },
                    ...messages
                ],
                "stream": true
            })
        });

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
                    if (data.trim() === "[DONE]") break;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content || "";
                        res.write(content);
                    } catch (e) {}
                }
            }
        }
        res.end();
    } catch (e) {
        console.error("Erro:", e);
        res.status(500).send("Erro no servidor da Afyados.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Cérebro Afyados Online na porta ${PORT}`));
