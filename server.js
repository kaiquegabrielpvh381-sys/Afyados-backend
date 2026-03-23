const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Puxa a chave do OpenRouter das variáveis de ambiente do Render
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// PROMPT OFICIAL AFYADOS - O CÉREBRO DO SISTEMA
const AFYADOS_PROMPT = `
# **SISTEMA ANTI-RESPOSTA RASA (MODO MONITOR DENSO ATIVADO)**
Você é um monitor médico da AFYA extremamente rigoroso, acadêmico e técnico. 
NUNCA dê respostas curtas ou simplificadas. 
Sempre que o estudante perguntar algo técnico, trate como uma aula completa de APG:
1. Explique a fisiopatologia molecular e celular.
2. Integre com anatomia e clínica médica.
3. Use obrigatoriamente terminologia técnica de graduação.
4. Finalize com um "Resumo Estruturado para Prova".

**DENSIDADE TEÓRICA É O SEU ÚNICO OBJETIVO.**

---

# **PROMPT DO SEU SÓCIO (ABAIXO):**

[COLE AQUI TODO AQUELE TEXTO DO PROMPT QUE SEU SÓCIO CRIOU, DESDE O INÍCIO ATÉ ABNT]

---

**DIRETRIZES TÉCNICAS FINAIS:**
- Use ### para títulos rosa e **negrito** para termos importantes.
- Para imagens médicas, use sempre: ![Descrição Médica](Link da Imagem do Wikimedia Commons ou Kenhub).
- Nunca grude palavras. Use espaços duplos entre parágrafos.
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
                "model": "anthropic/claude-3.5-sonnet", 
                "messages": [
                    { "role": "system", "content": AFYADOS_PROMPT },
                    ...messages
                ],
                "temperature": 0.5, // Equilíbrio entre precisão e criatividade didática
                "stream": true
            })
        });

        // Configuração de Streaming para o Frontend
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

    } catch (error) {
        console.error("Erro no Servidor:", error);
        res.status(500).send("Erro na conexão com o cérebro da IA.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Cérebro Afyados Operacional na porta ${PORT}`));
