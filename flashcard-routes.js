// ============================================================
// AFYADOS — Rotas de Flashcards
// Adicionar ao repo: /flashcard-routes.js
// ============================================================

const { createClient } = require("@supabase/supabase-js");

// ── Supabase Admin (service_role — bypassa RLS) ──
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Middleware: validar token JWT do Supabase Auth ──
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }
  const { data: { user }, error } = await supabase.auth.getUser(auth.split(" ")[1]);
  if (error || !user) {
    return res.status(401).json({ error: "Token inválido" });
  }
  req.user = user;
  next();
}

// ── Registrar rotas no app Express ──
function registerFlashcardRoutes(app) {

  // ─────────────────────────────────────────────
  // GET /api/decks
  // Lista todos os decks + marca acesso do usuário
  // ─────────────────────────────────────────────
  app.get("/api/decks", requireAuth, async (req, res) => {
    try {
      const { data: decks, error } = await supabase
        .from("decks")
        .select("id, name, slug, type, description, card_count, tag_list, is_free, product, cover_url")
        .order("name");

      if (error) throw error;

      // Checar assinaturas ativas do usuário
      const { data: subs } = await supabase
        .from("subscriptions")
        .select("product, status")
        .eq("user_id", req.user.id)
        .eq("status", "active");

      const activeProducts = new Set((subs || []).map(s => s.product));

      const result = decks.map(deck => ({
        ...deck,
        has_access: deck.is_free || deck.product === "free" || activeProducts.has(deck.product),
      }));

      res.json(result);
    } catch (err) {
      console.error("GET /api/decks:", err.message);
      res.status(500).json({ error: "Erro ao listar decks" });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/decks/:id/cards
  // Retorna cards do deck (com signed URLs para IO)
  // ─────────────────────────────────────────────
  app.get("/api/decks/:id/cards", requireAuth, async (req, res) => {
    try {
      const deckId = req.params.id;

      // Buscar deck
      const { data: deck, error: dErr } = await supabase
        .from("decks")
        .select("id, name, type, is_free, product")
        .eq("id", deckId)
        .single();

      if (dErr || !deck) return res.status(404).json({ error: "Deck não encontrado" });

      // Verificar acesso (free ou assinatura ativa)
      if (!deck.is_free && deck.product !== "free") {
        const { data: subs } = await supabase
          .from("subscriptions")
          .select("status")
          .eq("user_id", req.user.id)
          .eq("product", deck.product)
          .eq("status", "active")
          .limit(1);

        if (!subs || subs.length === 0) {
          return res.status(403).json({ error: "Assinatura necessária", product: deck.product });
        }
      }

      // Buscar cards
      const { data: cards, error: cErr } = await supabase
        .from("flashcards")
        .select("id, front, back, image_url, qmask_url, amask_url, tag, header, footer, sort_order")
        .eq("deck_id", deckId)
        .order("sort_order");

      if (cErr) throw cErr;

      // Image Occlusion: gerar signed URLs
      if (deck.type === "io") {
        const paths = new Set();
        cards.forEach(c => {
          if (c.image_url) paths.add(c.image_url);
          if (c.qmask_url) paths.add(c.qmask_url);
          if (c.amask_url) paths.add(c.amask_url);
        });

        if (paths.size > 0) {
          const { data: signed } = await supabase.storage
            .from("flashcard-media")
            .createSignedUrls([...paths], 3600);

          const urlMap = {};
          (signed || []).forEach(s => { if (s.signedUrl) urlMap[s.path] = s.signedUrl; });

          cards.forEach(c => {
            if (c.image_url) c.image_url = urlMap[c.image_url] || c.image_url;
            if (c.qmask_url) c.qmask_url = urlMap[c.qmask_url] || c.qmask_url;
            if (c.amask_url) c.amask_url = urlMap[c.amask_url] || c.amask_url;
          });
        }
      }

      res.json({ deck, cards });
    } catch (err) {
      console.error("GET /api/decks/:id/cards:", err.message);
      res.status(500).json({ error: "Erro ao buscar cards" });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/reviews/:deckId
  // Estado FSRS do usuário para um deck
  // ─────────────────────────────────────────────
  app.get("/api/reviews/:deckId", requireAuth, async (req, res) => {
    try {
      const { data: cards } = await supabase
        .from("flashcards")
        .select("id")
        .eq("deck_id", req.params.deckId);

      const cardIds = (cards || []).map(c => c.id);
      if (cardIds.length === 0) return res.json({ reviews: [] });

      const { data: reviews, error } = await supabase
        .from("flashcard_reviews")
        .select("card_id, state, stability, difficulty, interval_days, reps, lapses, due, last_review")
        .eq("user_id", req.user.id)
        .in("card_id", cardIds);

      if (error) throw error;
      res.json({ reviews: reviews || [] });
    } catch (err) {
      console.error("GET /api/reviews:", err.message);
      res.status(500).json({ error: "Erro ao buscar reviews" });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/reviews
  // Salva 1 review (FSRS calculado no client)
  // ─────────────────────────────────────────────
  app.post("/api/reviews", requireAuth, async (req, res) => {
    try {
      const { card_id, state, stability, difficulty, interval_days, reps, lapses, due, last_review } = req.body;

      if (!card_id || !state) {
        return res.status(400).json({ error: "card_id e state obrigatórios" });
      }

      const { data, error } = await supabase
        .from("flashcard_reviews")
        .upsert({
          user_id: req.user.id,
          card_id, state,
          stability: stability || 0,
          difficulty: difficulty || 0,
          interval_days: interval_days || 0,
          reps: reps || 0,
          lapses: lapses || 0,
          due: due || null,
          last_review: last_review || new Date().toISOString(),
        }, { onConflict: "user_id,card_id" })
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, review: data });
    } catch (err) {
      console.error("POST /api/reviews:", err.message);
      res.status(500).json({ error: "Erro ao salvar review" });
    }
  });

  // ─────────────────────────────────────────────
  // POST /api/reviews/batch
  // Salva múltiplas reviews (fim da sessão)
  // ─────────────────────────────────────────────
  app.post("/api/reviews/batch", requireAuth, async (req, res) => {
    try {
      const { reviews } = req.body;
      if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
        return res.status(400).json({ error: "Array de reviews obrigatório" });
      }

      const rows = reviews.map(r => ({
        user_id: req.user.id,
        card_id: r.card_id,
        state: r.state || "new",
        stability: r.stability || 0,
        difficulty: r.difficulty || 0,
        interval_days: r.interval_days || 0,
        reps: r.reps || 0,
        lapses: r.lapses || 0,
        due: r.due || null,
        last_review: r.last_review || new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("flashcard_reviews")
        .upsert(rows, { onConflict: "user_id,card_id" });

      if (error) throw error;
      res.json({ success: true, count: rows.length });
    } catch (err) {
      console.error("POST /api/reviews/batch:", err.message);
      res.status(500).json({ error: "Erro ao salvar reviews" });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/reviews/study/:deckId
  // Cards prontos pra estudar (new + due)
  // ─────────────────────────────────────────────
  app.get("/api/reviews/study/:deckId", requireAuth, async (req, res) => {
    try {
      const newLimit = parseInt(req.query.new_limit) || 20;
      const reviewLimit = parseInt(req.query.review_limit) || 100;

      const { data, error } = await supabase.rpc("get_study_cards", {
        p_user_id: req.user.id,
        p_deck_id: req.params.deckId,
        p_new_limit: newLimit,
        p_review_limit: reviewLimit,
      });

      if (error) throw error;
      res.json({ cards: data || [] });
    } catch (err) {
      console.error("GET /api/reviews/study:", err.message);
      res.status(500).json({ error: "Erro ao buscar cards" });
    }
  });

  console.log("✅ Rotas de Flashcards registradas");
}

module.exports = { registerFlashcardRoutes };
