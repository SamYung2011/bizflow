import {
  getCurrentUser,
  getSession,
  isAuthConfigured,
  resetPasswordForEmail,
  signInWithPassword,
  signOut,
  signUp,
  updatePassword
} from "../data/auth.js";

(function () {
  const dictionaries = {
    zh: {
      "meta.title.login": "Honnmono 登录",
      "meta.title.register": "Honnmono 注册",
      "meta.title.forgot": "Honnmono 修改密码",
      "brand.name": "HONNMONO",
      "brand.workspace": "Team Workspace",
      "brand.slogan": ["团队协作", "协同办公，数据同步。"],
      "brand.copyright": "© 2026 Honnmono International Ltd.",
      "card.title": "欢迎回来",
      "card.subtitle": "登录到你的团队工作区",
      "mode.login": "登录",
      "mode.register": "注册",
      "form.heading.login": "登录",
      "form.heading.register": "注册",
      "form.heading.forgot": "修改密码",
      "field.email": "账户邮箱",
      "field.regName": "姓名（必填）",
      "field.password": "密码",
      "field.company": "所属公司",
      "field.remark": "备注（选填）",
      "field.newPassword": "新密码",
      "field.confirmPassword": "确认密码",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "请输入姓名",
      "placeholder.company": "请输入所属公司",
      "action.login": "登录",
      "action.register": "注册",
      "action.confirmPassword": "确认密码",
      "action.forgot": "忘记密码？",
      "lang.zh": "繁中",
      "lang.en": "English",
      "lang.fr": "Français",
      "auth.processing": "处理中…",
      "auth.required": "请填写所有必填项",
      "auth.invalidCredentials": "邮箱或密码不正确",
      "auth.emailExists": "该邮箱已注册",
      "auth.weakPassword": "密码强度不足，请至少输入 6 位",
      "auth.failed": "操作失败，请稍后重试",
      "auth.pending": "账户尚未通过人员审核",
      "auth.registered": "注册申请已提交，请等待管理员审核",
      "auth.resetSent": "重置密码邮件已发送，请从邮件链接继续",
      "auth.passwordMismatch": "两次输入的密码不一致",
      "auth.passwordUpdated": "密码已更新，请重新登录"
    },
    en: {
      "meta.title.login": "Honnmono Login",
      "meta.title.register": "Honnmono Register",
      "meta.title.forgot": "Honnmono Reset Password",
      "brand.name": "HONNMONO",
      "brand.workspace": "Team Workspace",
      "brand.slogan": ["Work together", "Data in sync."],
      "brand.copyright": "© 2026 Honnmono International Ltd.",
      "card.title": "Welcome back",
      "card.subtitle": "Log in to your team workspace",
      "mode.login": "Login",
      "mode.register": "Register",
      "form.heading.login": "Login",
      "form.heading.register": "Register",
      "form.heading.forgot": "Reset password",
      "field.email": "Account email",
      "field.regName": "Name (required)",
      "field.password": "Password",
      "field.company": "Company",
      "field.remark": "Remark (optional)",
      "field.newPassword": "New password",
      "field.confirmPassword": "Confirm password",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "Enter your name",
      "placeholder.company": "Enter your company",
      "action.login": "Login",
      "action.register": "Register",
      "action.confirmPassword": "Confirm password",
      "action.forgot": "Forgot password?",
      "lang.zh": "繁中",
      "lang.en": "English",
      "lang.fr": "Français",
      "auth.processing": "Processing…",
      "auth.required": "Complete all required fields",
      "auth.invalidCredentials": "Incorrect email or password",
      "auth.emailExists": "This email is already registered",
      "auth.weakPassword": "Use a password with at least 6 characters",
      "auth.failed": "The operation failed. Try again later",
      "auth.pending": "Your personnel account is awaiting approval",
      "auth.registered": "Registration submitted for administrator review",
      "auth.resetSent": "Password reset email sent. Continue from the email link",
      "auth.passwordMismatch": "The passwords do not match",
      "auth.passwordUpdated": "Password updated. Log in again"
    },
    fr: {
      "meta.title.login": "Connexion Honnmono",
      "meta.title.register": "Inscription Honnmono",
      "meta.title.forgot": "Mot de passe Honnmono",
      "brand.name": "HONNMONO",
      "brand.workspace": "Team Workspace",
      "brand.slogan": ["Travailler ensemble", "Données à jour."],
      "brand.copyright": "© 2026 Honnmono International Ltd.",
      "card.title": "Bon retour",
      "card.subtitle": "Connectez-vous à votre espace d'équipe",
      "mode.login": "Connexion",
      "mode.register": "Inscription",
      "form.heading.login": "Connexion",
      "form.heading.register": "Inscription",
      "form.heading.forgot": "Modifier le mot de passe",
      "field.email": "E-mail du compte",
      "field.regName": "Nom (requis)",
      "field.password": "Mot de passe",
      "field.company": "Entreprise",
      "field.remark": "Remarque (facultative)",
      "field.newPassword": "Nouveau mot de passe",
      "field.confirmPassword": "Confirmer le mot de passe",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "Saisissez votre nom",
      "placeholder.company": "Saisissez votre entreprise",
      "action.login": "Connexion",
      "action.register": "Inscription",
      "action.confirmPassword": "Confirmer le mot de passe",
      "action.forgot": "Mot de passe oublié ?",
      "lang.zh": "繁中",
      "lang.en": "English",
      "lang.fr": "Français",
      "auth.processing": "Traitement…",
      "auth.required": "Remplissez tous les champs obligatoires",
      "auth.invalidCredentials": "E-mail ou mot de passe incorrect",
      "auth.emailExists": "Cet e-mail est déjà enregistré",
      "auth.weakPassword": "Utilisez un mot de passe d'au moins 6 caractères",
      "auth.failed": "L'opération a échoué. Réessayez plus tard",
      "auth.pending": "Votre compte employé est en attente d'approbation",
      "auth.registered": "Inscription envoyée pour validation",
      "auth.resetSent": "E-mail de réinitialisation envoyé. Continuez depuis le lien reçu",
      "auth.passwordMismatch": "Les mots de passe ne correspondent pas",
      "auth.passwordUpdated": "Mot de passe mis à jour. Reconnectez-vous"
    }
  };

  const views = ["login", "register", "forgot"];
  const langs = ["zh", "en", "fr"];
  const params = new URLSearchParams(window.location.search);
  const recoveryHint = params.get("recovery") === "1" || window.location.hash.includes("type=recovery");
  const initialView = recoveryHint ? "forgot" : params.get("view");
  const initialLang = params.get("lang");
  const state = {
    lang: langs.includes(initialLang) ? initialLang : "zh",
    view: views.includes(initialView) ? initialView : "login",
    authConfigured: false,
    authReady: false,
    busy: false,
    recovery: recoveryHint,
    messageKey: "",
    messageTone: ""
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const t = (key) => dictionaries[state.lang][key] || dictionaries.zh[key] || key;
  const screen = $(".login-screen");

  function setText(node, value) {
    node.textContent = value;
    node.title = value;
  }

  function renderText() {
    document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : state.lang;
    document.title = t(`meta.title.${state.view}`);

    $$("[data-i18n]").forEach((node) => {
      setText(node, t(node.dataset.i18n));
    });

    $$("[data-i18n-lines]").forEach((node) => {
      node.replaceChildren();
      const lines = t(node.dataset.i18nLines);
      lines.forEach((line) => {
        const span = document.createElement("span");
        span.className = "login-brand__slogan-line";
        span.textContent = line;
        span.title = line;
        node.append(span);
      });
    });

    $$("[data-placeholder-key]").forEach((node) => {
      node.placeholder = t(node.dataset.placeholderKey);
    });

    $(".login-form__heading").dataset.i18n = `form.heading.${state.view}`;
    setText($(".login-form__heading"), t(`form.heading.${state.view}`));
    setText($(".login-submit"), t(state.busy ? "auth.processing" : state.view === "forgot" ? "action.confirmPassword" : `action.${state.view}`));
    const message = $(".login-auth-message");
    message.hidden = !state.messageKey;
    message.dataset.tone = state.messageTone;
    if (state.messageKey) setText(message, t(state.messageKey));
  }

  function renderView() {
    screen.dataset.view = state.view;

    $$(".app-segment__button").forEach((button) => {
      const isActive = button.dataset.viewTarget === state.view;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    const segment = $("[data-segment]");
    segment.hidden = state.view === "forgot";
    segment.dataset.activeIndex = state.view === "register" ? "1" : "0";
    $("[data-mobile-brand]").hidden = state.view === "register";
    $(".login-forgot").hidden = state.view !== "login";

    $$("[data-field-views]").forEach((field) => {
      const visible = field.dataset.fieldViews.split(" ").includes(state.view);
      field.hidden = !visible;
    });

    // 煊煊已拍：company 只属于注册态，不进入登录或改密提交数据。
    $("input[name='company']").disabled = state.view !== "register";
    $("input[name='password']").autocomplete = state.view === "register" ? "new-password" : "current-password";
    renderText();
  }

  function renderLanguage() {
    $$(".login-language__button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.lang === state.lang);
    });
    renderText();
  }

  function setView(view) {
    if (!views.includes(view)) return;
    state.view = view;
    state.messageKey = "";
    state.messageTone = "";
    renderView();
  }

  function setBusy(busy) {
    state.busy = busy;
    $$(".login-form input, .login-form textarea, .login-submit").forEach((control) => {
      control.disabled = busy;
    });
    renderText();
  }

  function showMessage(key, tone = "error") {
    state.messageKey = key;
    state.messageTone = tone;
    renderText();
  }

  function authErrorKey(error) {
    if (error?.code === "invalid_credentials") return "auth.invalidCredentials";
    if (["user_already_exists", "email_exists"].includes(error?.code)) return "auth.emailExists";
    if (error?.code === "weak_password") return "auth.weakPassword";
    return "auth.failed";
  }

  function routeForUser(user) {
    const path = user?.isBfAdmin || user?.bizflowMainAccess
      ? "../bizflow/home.html"
      : "../team/index.html";
    window.location.replace(path);
  }

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-target]");
    if (viewButton) {
      setView(viewButton.dataset.viewTarget);
      return;
    }

    const forgotButton = event.target.closest("[data-action='forgot']");
    if (forgotButton) {
      setView("forgot");
      return;
    }

    const langButton = event.target.closest("[data-lang]");
    if (langButton) {
      state.lang = langButton.dataset.lang;
      renderLanguage();
    }
  });

  $(".login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.authReady || state.busy) return;
    if (!state.authConfigured) {
      if (state.view === "login") window.location.href = "../bizflow/home.html";
      else if (state.view === "forgot") setView("login");
      return;
    }
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") || "").trim();
    const password = String(values.get("password") || "");
    const newPassword = String(values.get("newPassword") || "");
    const confirmPassword = String(values.get("confirmPassword") || "");
    setBusy(true);
    try {
      if (state.view === "login") {
        if (!email || !password) throw { messageKey: "auth.required" };
        await signInWithPassword({ email, password });
        const user = await getCurrentUser({ refresh: true });
        if (!user) {
          await signOut();
          throw { messageKey: "auth.pending" };
        }
        routeForUser(user);
        return;
      }
      if (state.view === "register") {
        const name = String(values.get("regName") || "").trim();
        const companyName = String(values.get("company") || "").trim();
        const note = String(values.get("remark") || "").trim();
        if (!email || !password || !name || !companyName) throw { messageKey: "auth.required" };
        if (password.length < 6) throw { messageKey: "auth.weakPassword" };
        await signUp({ email, password, name, companyName, note });
        await signOut();
        event.currentTarget.reset();
        state.view = "login";
        showMessage("auth.registered", "success");
        renderView();
        return;
      }
      if (!email) throw { messageKey: "auth.required" };
      if (!state.recovery) {
        const redirectTo = new URL("./index.html?view=forgot&recovery=1", window.location.href).href;
        await resetPasswordForEmail(email, redirectTo);
        showMessage("auth.resetSent", "success");
        return;
      }
      if (newPassword.length < 6) throw { messageKey: "auth.weakPassword" };
      if (newPassword !== confirmPassword) throw { messageKey: "auth.passwordMismatch" };
      await updatePassword(newPassword);
      await signOut();
      state.recovery = false;
      state.view = "login";
      showMessage("auth.passwordUpdated", "success");
      renderView();
    } catch (error) {
      showMessage(error?.messageKey || authErrorKey(error));
    } finally {
      setBusy(false);
    }
  });

  renderView();
  renderLanguage();
  void (async () => {
    try {
      state.authConfigured = await isAuthConfigured();
      if (state.authConfigured) {
        const session = await getSession();
        if (session) {
          if (state.recovery) {
            $("input[name='email']").value = session.user.email || "";
          } else {
            const user = await getCurrentUser({ refresh: true });
            if (user) routeForUser(user);
            else {
              await signOut();
              showMessage("auth.pending");
            }
          }
        }
      }
    } catch {
      showMessage("auth.failed");
    } finally {
      state.authReady = true;
    }
  })();
})();
