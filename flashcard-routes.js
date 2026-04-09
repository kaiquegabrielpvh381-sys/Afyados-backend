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

// ── Helper: encontrar usuário por email (paginação completa) ──
// listUsers() padrão retorna só 50 — precisamos paginar pra achar
// emails que entraram depois da página 1.
async function findUserByEmail(email) {
  const target = email.toLowerCase().trim();
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = (data && data.users) || [];
    const found = users.find(function (u) {
      return (u.email || "").toLowerCase() === target;
    });
    if (found) return found;
    if (users.length < perPage) return null; // última página
    page += 1;
    if (page > 50) return null; // safety stop (50k usuários)
  }
}

// ── Helper: garantir que o usuário existe (idempotente) ──
async function ensureUser(email, fullName) {
  const existing = await findUserByEmail(email);
  if (existing) return { user: existing, created: false };

  const tempPassword = "Afyados2026!" + Math.random().toString(36).substring(2, 8);
  const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
    email: email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName || email.split("@")[0] }
  });

  if (createErr) {
    // Race condition: outro request criou no meio. Re-busca.
    if ((createErr.message || "").toLowerCase().includes("already")) {
      const retry = await findUserByEmail(email);
      if (retry) return { user: retry, created: false };
    }
    throw createErr;
  }
  return { user: newUser.user, created: true };
}

// ── Helper: disparar email de "defina sua senha" via Supabase Auth ──
// Usa resetPasswordForEmail porque dispara o template "Reset Password"
// configurado no Supabase (que vamos customizar pra ficar em português).
// O Supabase Auth mandará via SMTP custom (Resend) configurado no painel.
async function sendPasswordRecovery(email, redirectPath) {
  const site = process.env.SITE_URL || "https://afyadoss.com.br";
  const path = redirectPath || "/reset-password.html";
  const redirectTo = site + path;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo
  });
  if (error) throw error;
  return true;
}

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

      // 1. Garantir que o usuário existe (paginação completa via helper)
      let user, created;
      try {
        const r = await ensureUser(email, name);
        user = r.user;
        created = r.created;
      } catch (e) {
        console.error("Webhook: erro ao garantir usuário:", e.message);
        // IMPORTANTE: devolvemos 200 mesmo em erro pra Kiwify NÃO reenfileirar.
        // O erro fica logado pra reprocessamento manual.
        return res.json({ ok: true, error: "user_lookup_failed", message: e.message });
      }
      const userId = user.id;
      if (created) console.log("Webhook: novo usuário criado | id=" + userId);

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
        // Mesmo motivo: 200 pra não loopar.
        return res.json({ ok: true, error: "subscription_save_failed", message: subErr.message });
      }

      console.log("Webhook: subscription salva | user=" + userId + " | product=clube");

      // 3. Se é usuário novo, dispara email de "defina sua senha" automaticamente.
      // Pra compras repetidas (renovação, upgrade) não manda, pra não encher o email dela.
      if (created) {
        try {
          await sendPasswordRecovery(email, "/reset-password.html");
          console.log("Webhook: email de boas-vindas enviado | email=" + email);
        } catch (e) {
          // Não falha o webhook — a aluna pode pedir reset manualmente depois.
          console.error("Webhook: erro ao enviar recovery:", e.message);
        }
      }

      res.json({ ok: true, user_id: userId, created: created });

    } catch (err) {
      console.error("Webhook Kiwify error:", err.message);
      // 200 sempre — evita loop infinito da Kiwify.
      res.json({ ok: true, error: "internal", message: err.message });
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

  // ─────────────────────────────────────────────
  // ADMIN ROUTES
  // ─────────────────────────────────────────────
  var ADMINS = ["kaiquegabrielpvh381@gmail.com", "dcalddeira@gmail.com", "albertoiriarte07@gmail.com", "analuiza28464@gmail.com", "ludalmeiida@gmail.com"];

  function requireAdmin(req, res, next) {
    if (!req.user || ADMINS.indexOf(req.user.email) === -1) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    next();
  }

  // POST /api/admin/grant-access
  app.post("/api/admin/grant-access", requireAuth, requireAdmin, async (req, res) => {
    try {
      var email = (req.body.email || "").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Email obrigatório" });

      // Garantir usuário (paginação completa via helper)
      let user, created;
      try {
        const r = await ensureUser(email, null);
        user = r.user;
        created = r.created;
      } catch (e) {
        console.error("grant-access: erro ao garantir usuário:", e.message);
        return res.status(500).json({ error: "Erro ao garantir usuário: " + e.message });
      }

      // Upsert subscription
      var { error: subErr } = await supabase.from("subscriptions").upsert({
        user_id: user.id,
        email: email,
        product: "clube",
        status: "active",
        product_name: "PRIMEIRO PERÍODO - AFYADOS",
        purchased_at: new Date().toISOString()
      }, { onConflict: "user_id,product" });

      if (subErr) return res.status(500).json({ error: "Erro ao salvar: " + subErr.message });

      // Se é usuário novo, dispara email de "defina sua senha" automaticamente.
      let recoverySent = false;
      if (created) {
        try {
          await sendPasswordRecovery(email, "/reset-password.html");
          recoverySent = true;
        } catch (e) {
          console.error("grant-access: erro ao enviar recovery:", e.message);
        }
      }

      res.json({ ok: true, email: email, user_id: user.id, created: created, recovery_sent: recoverySent });
    } catch (err) {
      console.error("POST /api/admin/grant-access:", err.message);
      res.status(500).json({ error: "Erro interno: " + err.message });
    }
  });

  // POST /api/admin/send-reset
  // Dispara email de "defina sua senha" pra UM email específico.
  // Usado pra desbloquear alunas travadas que já tem subscription ativa
  // mas nunca conseguiram definir a senha.
  app.post("/api/admin/send-reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      var email = (req.body.email || "").toLowerCase().trim();
      if (!email) return res.status(400).json({ error: "Email obrigatório" });

      try {
        await sendPasswordRecovery(email, "/reset-password.html");
      } catch (e) {
        console.error("send-reset: erro:", e.message);
        return res.status(500).json({ error: "Erro ao enviar: " + e.message });
      }

      res.json({ ok: true, email: email });
    } catch (err) {
      console.error("POST /api/admin/send-reset:", err.message);
      res.status(500).json({ error: "Erro interno: " + err.message });
    }
  });

  // POST /api/admin/send-reset-bulk
  // Dispara email de "defina sua senha" pra TODAS as assinantes ativas.
  // Usado pra resolver o backlog de uma vez.
  // Respeita rate limit do Resend (10 por segundo) com delay entre envios.
  app.post("/api/admin/send-reset-bulk", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { data: subs, error } = await supabase
        .from("subscriptions")
        .select("email")
        .eq("status", "active");

      if (error) return res.status(500).json({ error: "Erro ao listar assinantes: " + error.message });
      if (!subs || subs.length === 0) return res.json({ ok: true, sent: 0, total: 0, errors: [] });

      // Dedupe (caso o mesmo email apareça em múltiplos produtos)
      const emails = Array.from(new Set(subs.map(s => (s.email || "").toLowerCase().trim()).filter(Boolean)));

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      let sent = 0;
      const errors = [];

      for (const email of emails) {
        try {
          await sendPasswordRecovery(email, "/reset-password.html");
          sent += 1;
        } catch (e) {
          errors.push({ email: email, error: e.message });
          console.error("send-reset-bulk: falha pra " + email + ": " + e.message);
        }
        // Delay de 200ms entre envios = ~5/s, bem abaixo do limite do Resend (10/s).
        await sleep(200);
      }

      res.json({ ok: true, sent: sent, total: emails.length, errors: errors });
    } catch (err) {
      console.error("POST /api/admin/send-reset-bulk:", err.message);
      res.status(500).json({ error: "Erro interno: " + err.message });
    }
  });

  // POST /api/admin/revoke-access
  app.post("/api/admin/revoke-access", requireAuth, requireAdmin, async (req, res) => {
    try {
      var email = (req.body.email || "").toLowerCase().trim();
      var { error } = await supabase.from("subscriptions").delete().eq("email", email);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // GET /api/admin/subscriptions
  app.get("/api/admin/subscriptions", requireAuth, requireAdmin, async (req, res) => {
    try {
      var { data: subs } = await supabase.from("subscriptions").select("email, status, product_name, purchased_at").order("purchased_at", { ascending: false });
      res.json({ subscriptions: subs || [] });
    } catch (err) {
      res.status(500).json({ error: "Erro interno" });
    }
  });

  console.log("✅ Rotas de Flashcards registradas");
}

module.exports = { registerFlashcardRoutes };
