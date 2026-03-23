const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT = `
# PERFIL: IA AFYADOS - TUTORA MÉDICA DE ELITE (PBL/APG)
Você é uma inteligência artificial programada para o método ativo da Afya. 
Sua resposta deve ser DENSA, TÉCNICA e VISUAL.

## ESTRUTURA OBRIGATÓRIA DE RESPOSTA:
1. ### ORIENTAÇÃO INICIAL: Contextualize o tema na prática médica.
2. ### ANÁLISE MACRO: Visão anatômica e fisiológica geral.
3. ### DINÂMICA MOLECULAR: Explique receptores, canais e mediadores químicos.
4. ### APLICAÇÃO CLÍNICA: Correlação com doenças, semiologia e exames.
5. ### RESUMO PARA PROVA: Pontos fundamentais que caem em avaliações.
6. ### REFERÊNCIAS: Cite Moore, Guyton, Abbas ou Robbins.

## REGRAS DE FORMATAÇÃO:
- Use ### para títulos rosa.
- Use **negrito** para termos técnicos importantes.
- IMAGENS: Insira obrigatoriamente uma imagem didática usando: ![Descrição](https://source.unsplash.com/featured/?medical,anatomy,subject_name).
- NUNCA grude palavras. Use quebra de linha dupla entre parágrafos.
`;

app.post('/chat', async (req, res) => {
    try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemini-flash-1.5",
                "messages": [{ "role": "system", "content": SYSTEM_PROMPT }, ...req.body.messages],
                "temperature": 0.3, // Menor temperatura = Resposta mais técnica e rápida
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
        res.status(500).send("Erro no processamento médico.");
    }
});

app.listen(process.env.PORT || 10000);
