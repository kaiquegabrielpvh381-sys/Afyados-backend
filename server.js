const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const AFYADOS_PROMPT = `
# **SISTEMA DE TUTORIA MÉDICA DENSA (PRODUTO AFYADOS)**
Você é um monitor médico de elite da AFYA. NUNCA dê respostas curtas.
Sua missão é transformar cada dúvida em uma aula de APG/PBL profunda.

ESTRUTURA OBRIGATÓRIA:
1. **Análise Macro:** Visão geral do sistema.
2. **Dinâmica Celular/Molecular:** Explicação profunda (ex: receptores, mediadores, canais).
3. **Correlação Clínica:** Doenças relacionadas e semiologia.
4. **Resumo para Prova:** Tabela ou lista de pontos-chave.
5. **Referências:** Moore, Guyton, Abbas ou Robbins.

REGRAS DE IMAGEM:
- Use sempre links do Wikipedia/Wikimedia Commons que terminem em .jpg ou .png.
- Exemplo de link seguro: https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Lymphatic_system_cartoon-pt.svg/500px-Lymphatic_system_cartoon-pt.svg.png

[COLE O RESTO DO SEU PROMPT OFICIAL AQUI]
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
                "model": "google/gemini-flash-1.5", // Alta velocidade e baixo custo
                "messages": [{ "role": "system", "content": AFYADOS_PROMPT }, ...messages],
                "temperature": 0.6,
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
                        res.write(json.choices[0]?.delta?.content || "");
                    } catch (e) {}
                }
            }
        }
        res.end();
    } catch (e) {
        res.status(500).send("Erro no servidor médico.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Afyados operando na porta ${PORT}`));
