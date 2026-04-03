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

      // Bucket é público — URLs montadas no frontend com STORAGE_URL + path

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

  // ─────────────────────────────────────────────
  // POST /api/webhook/kiwify
  // Webhook da Kiwify — recebe notificação de compra
  // Configura na Kiwify: URL = https://afyados-backend.onrender.com/api/webhook/kiwify
  // ─────────────────────────────────────────────
  app.post("/api/webhook/kiwify", async (req, res) => {
    try {
      var body = req.body;

      // Kiwify envia diferentes eventos
      var orderStatus = body.order_status;

      // Só processar compras aprovadas
      if (orderStatus !== "paid" && orderStatus !== "completed") {
        return res.json({ ok: true, skipped: true });
      }

      var email = (body.Customer && body.Customer.email) ? body.Customer.email.toLowerCase().trim() : null;
      var name = (body.Customer && body.Customer.full_name) ? body.Customer.full_name : null;
      var productName = (body.Product && body.Product.product_name) ? body.Product.product_name : "";
      var orderId = body.order_id || "";

      if (!email) {
        console.error("Webhook Kiwify: email não encontrado", JSON.stringify(body).substring(0, 200));
        return res.status(400).json({ error: "Email não encontrado" });
      }

      console.log("Webhook Kiwify: compra aprovada | email=" + email + " | produto=" + productName);

      // 1. Criar usuário no Supabase Auth se não existir
      var { data: existingUsers } = await supabase.auth.admin.listUsers();
      var existingUser = (existingUsers && existingUsers.users) ?
        existingUsers.users.find(function(u) { return u.email === email; }) : null;

      var userId;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        // Criar usuário com senha temporária (aluno troca depois)
        var tempPassword = "Afyados2026!" + Math.random().toString(36).substring(2, 8);
        var { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
          email: email,
          password: tempPassword,
          email_confirm: true,
          user_metadata: { full_name: name || email.split("@")[0] }
        });
        if (createErr) {
          console.error("Webhook: erro ao criar usuário:", createErr.message);
          return res.status(500).json({ error: "Erro ao criar usuário" });
        }
        userId = newUser.user.id;
        console.log("Webhook: novo usuário criado | id=" + userId);
      }

      // 2. Salvar/atualizar na tabela subscriptions
      var { error: subErr } = await supabase
        .from("subscriptions")
        .upsert({
          user_id: userId,
          email: email,
          product: "clube",
          product_name: productName,
          status: "active",
          kiwify_order_id: orderId,
          purchased_at: new Date().toISOString()
        }, { onConflict: "user_id,product" });

      if (subErr) {
        console.error("Webhook: erro ao salvar subscription:", subErr.message);
        return res.status(500).json({ error: "Erro ao salvar" });
      }

      console.log("Webhook: subscription salva | user=" + userId + " | product=clube");
      res.json({ ok: true, user_id: userId });

    } catch (err) {
      console.error("Webhook Kiwify error:", err.message);
      res.status(500).json({ error: "Erro no webhook" });
    }
  });

  // ─────────────────────────────────────────────
  // GET /api/access/check
  // Verifica se o usuário logado tem acesso aos flashcards
  // ─────────────────────────────────────────────
  app.get("/api/access/check", requireAuth, async (req, res) => {
    try {
      var { data: subs } = await supabase
        .from("subscriptions")
        .select("product, status, product_name")
        .eq("user_id", req.user.id)
        .eq("status", "active");

      var hasAccess = subs && subs.length > 0;

      res.json({
        has_access: hasAccess,
        email: req.user.email,
        subscriptions: subs || []
      });
    } catch (err) {
      console.error("GET /api/access/check:", err.message);
      res.status(500).json({ error: "Erro ao verificar acesso" });
    }
  });

  console.log("✅ Rotas de Flashcards registradas");
}

module.exports = { registerFlashcardRoutes };
