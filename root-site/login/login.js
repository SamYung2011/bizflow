import {
  getCurrentUser,
  getSession,
  isAuthConfigured,
  resetPasswordForEmail,
  signInWithPassword,
  signOut,
  signUp,
  updatePassword,
  verifyRecoveryOtp
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
      "field.verificationCode": "驗證碼",
      "field.newPassword": "新密码",
      "field.confirmPassword": "确认密码",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "请输入姓名",
      "placeholder.company": "请输入所属公司",
      "placeholder.verificationCode": "6 位驗證碼",
      "action.login": "登录",
      "action.register": "注册",
      "action.sendCode": "發送驗證碼",
      "action.verifyCode": "驗證",
      "action.confirmPassword": "确认密码",
      "action.forgot": "忘记密码？",
      "action.resendCode": "重新發送驗證碼",
      "action.resendCountdown": "重新發送（{seconds}s）",
      "action.backLogin": "返回登入",
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
      "auth.resetSent": "驗證碼已發送，請查看郵件",
      "auth.otpFormat": "請輸入 6 位數字驗證碼",
      "auth.otpInvalidOrExpired": "驗證碼錯誤或已過期，請重新發送後再試",
      "auth.otpVerified": "驗證成功，請設定新密碼",
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
      "field.verificationCode": "Verification code",
      "field.newPassword": "New password",
      "field.confirmPassword": "Confirm password",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "Enter your name",
      "placeholder.company": "Enter your company",
      "placeholder.verificationCode": "6-digit code",
      "action.login": "Login",
      "action.register": "Register",
      "action.sendCode": "Send verification code",
      "action.verifyCode": "Verify code",
      "action.confirmPassword": "Confirm password",
      "action.forgot": "Forgot password?",
      "action.resendCode": "Resend verification code",
      "action.resendCountdown": "Resend ({seconds}s)",
      "action.backLogin": "Back to login",
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
      "auth.resetSent": "Verification code sent. Check your email",
      "auth.otpFormat": "Enter the 6-digit verification code",
      "auth.otpInvalidOrExpired": "The verification code is incorrect or expired. Resend it and try again",
      "auth.otpVerified": "Verification succeeded. Set your new password",
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
      "field.verificationCode": "Code de vérification",
      "field.newPassword": "Nouveau mot de passe",
      "field.confirmPassword": "Confirmer le mot de passe",
      "placeholder.email": "123@email.com",
      "placeholder.regName": "Saisissez votre nom",
      "placeholder.company": "Saisissez votre entreprise",
      "placeholder.verificationCode": "Code à 6 chiffres",
      "action.login": "Connexion",
      "action.register": "Inscription",
      "action.sendCode": "Envoyer le code de vérification",
      "action.verifyCode": "Vérifier le code",
      "action.confirmPassword": "Confirmer le mot de passe",
      "action.forgot": "Mot de passe oublié ?",
      "action.resendCode": "Renvoyer le code de vérification",
      "action.resendCountdown": "Renvoyer ({seconds}s)",
      "action.backLogin": "Retour à la connexion",
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
      "auth.resetSent": "Code de vérification envoyé. Consultez votre e-mail",
      "auth.otpFormat": "Saisissez le code de vérification à 6 chiffres",
      "auth.otpInvalidOrExpired": "Le code de vérification est incorrect ou expiré. Renvoyez-le puis réessayez",
      "auth.otpVerified": "Vérification réussie. Définissez votre nouveau mot de passe",
      "auth.passwordMismatch": "Les mots de passe ne correspondent pas",
      "auth.passwordUpdated": "Mot de passe mis à jour. Reconnectez-vous"
    }
  };

  const views = ["login", "register", "forgot"];
  const forgotStages = ["request", "verify", "password"];
  const langs = ["zh", "en", "fr"];
  const RESEND_DELAY_SECONDS = 60;
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
    recoveryLink: recoveryHint,
    forgotStage: recoveryHint ? "password" : "request",
    recoveryEmail: "",
    resendRemaining: 0,
    messageKey: "",
    messageTone: ""
  };
  let resendDeadline = 0;
  let resendTimer = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const t = (key) => dictionaries[state.lang][key] || dictionaries.zh[key] || key;
  const tf = (key, values) => t(key).replace(/\{(\w+)\}/g, (match, name) => String(values?.[name] ?? match));
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
    const forgotSubmitKey = {
      request: "action.sendCode",
      verify: "action.verifyCode",
      password: "action.confirmPassword"
    }[state.forgotStage];
    setText($(".login-submit"), t(state.busy ? "auth.processing" : state.view === "forgot" ? forgotSubmitKey : `action.${state.view}`));
    const resendButton = $("[data-action='resend-code']");
    setText(
      resendButton,
      state.resendRemaining > 0
        ? tf("action.resendCountdown", { seconds: state.resendRemaining })
        : t("action.resendCode")
    );
    const message = $(".login-auth-message");
    message.hidden = !state.messageKey;
    message.dataset.tone = state.messageTone;
    if (state.messageKey) setText(message, t(state.messageKey));
  }

  function fieldIsVisible(field) {
    if (!field.dataset.fieldViews.split(" ").includes(state.view)) return false;
    if (state.view !== "forgot") return true;
    const stages = field.dataset.forgotStages?.split(" ") || forgotStages;
    return stages.includes(state.forgotStage);
  }

  function syncControlState() {
    $$(".login-form input, .login-form textarea").forEach((control) => {
      control.disabled = state.busy || Boolean(control.closest(".login-field")?.hidden);
    });
    $$(".login-form button").forEach((button) => {
      button.disabled = state.busy;
    });
    $("[data-action='resend-code']").disabled = state.busy || state.resendRemaining > 0;
  }

  function renderView() {
    screen.dataset.view = state.view;
    screen.dataset.forgotStage = state.view === "forgot" ? state.forgotStage : "";

    $$(".app-segment__button").forEach((button) => {
      const isActive = button.dataset.viewTarget === state.view;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    const segment = $("[data-segment]");
    segment.hidden = state.view === "forgot";
    segment.dataset.activeIndex = state.view === "register" ? "1" : "0";
    $("[data-mobile-brand]").hidden = state.view === "register";
    $("[data-action='forgot']").hidden = state.view !== "login";
    $("[data-action='resend-code']").hidden = state.view !== "forgot" || state.forgotStage !== "verify";
    $("[data-action='back-login']").hidden = state.view !== "forgot";

    $$("[data-field-views]").forEach((field) => {
      field.hidden = !fieldIsVisible(field);
    });

    // 煊煊已拍：company 只属于注册态，不进入登录或改密提交数据。
    $("input[name='password']").autocomplete = state.view === "register" ? "new-password" : "current-password";
    syncControlState();
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
    if (view === "forgot" && state.view !== "forgot") resetForgotFlow();
    if (view !== "forgot" && state.view === "forgot") resetForgotFlow();
    state.view = view;
    state.messageKey = "";
    state.messageTone = "";
    renderView();
  }

  function setBusy(busy) {
    state.busy = busy;
    syncControlState();
    renderText();
  }

  function stopResendCountdown() {
    if (resendTimer) window.clearInterval(resendTimer);
    resendTimer = 0;
    resendDeadline = 0;
    state.resendRemaining = 0;
  }

  function updateResendCountdown() {
    state.resendRemaining = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
    if (state.resendRemaining === 0 && resendTimer) {
      window.clearInterval(resendTimer);
      resendTimer = 0;
    }
    syncControlState();
    renderText();
  }

  function startResendCountdown() {
    stopResendCountdown();
    resendDeadline = Date.now() + RESEND_DELAY_SECONDS * 1000;
    updateResendCountdown();
    resendTimer = window.setInterval(updateResendCountdown, 1000);
  }

  function resetForgotFlow() {
    stopResendCountdown();
    state.forgotStage = "request";
    state.recoveryEmail = "";
    for (const name of ["recoveryToken", "newPassword", "confirmPassword"]) {
      const input = $(`input[name='${name}']`);
      if (input) input.value = "";
    }
  }

  function showMessage(key, tone = "error") {
    state.messageKey = key;
    state.messageTone = tone;
    renderText();
  }

  function authErrorKey(error) {
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();
    if (state.view === "forgot" && state.forgotStage === "verify"
      && (error?.status === 403 || /otp|token|code/.test(`${code} ${message}`))) {
      return "auth.otpInvalidOrExpired";
    }
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

  function recoveryRedirectUrl() {
    return new URL("./index.html?view=forgot&recovery=1", window.location.href).href;
  }

  function clearRecoveryUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    url.searchParams.delete("recovery");
    if (url.hash.includes("type=recovery")) url.hash = "";
    window.history.replaceState(window.history.state, "", url.href);
  }

  async function sendRecoveryCode(email) {
    await resetPasswordForEmail(email, recoveryRedirectUrl());
    state.recoveryEmail = email;
    state.forgotStage = "verify";
    $("input[name='recoveryToken']").value = "";
    startResendCountdown();
    renderView();
    showMessage("auth.resetSent", "success");
  }

  async function resendRecoveryCode() {
    if (state.busy || state.resendRemaining > 0 || state.forgotStage !== "verify" || !state.recoveryEmail) return;
    setBusy(true);
    try {
      await resetPasswordForEmail(state.recoveryEmail, recoveryRedirectUrl());
      startResendCountdown();
      showMessage("auth.resetSent", "success");
    } catch (error) {
      showMessage(authErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  async function returnToLogin() {
    if (state.busy) return;
    const emailInput = $("input[name='email']");
    if (emailInput) emailInput.value = "";
    const hasRecoverySession = state.forgotStage === "password";
    if (hasRecoverySession && state.authConfigured && state.authReady) {
      setBusy(true);
      try {
        await signOut();
      } catch {
        // Returning to the login form must not be trapped by a remote sign-out failure.
      } finally {
        state.recoveryLink = false;
        clearRecoveryUrl();
        setView("login");
        setBusy(false);
      }
      return;
    }
    if (!hasRecoverySession) state.recoveryLink = false;
    clearRecoveryUrl();
    setView("login");
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

    const resendButton = event.target.closest("[data-action='resend-code']");
    if (resendButton) {
      void resendRecoveryCode();
      return;
    }

    const backButton = event.target.closest("[data-action='back-login']");
    if (backButton) {
      void returnToLogin();
      return;
    }

    const langButton = event.target.closest("[data-lang]");
    if (langButton) {
      state.lang = langButton.dataset.lang;
      renderLanguage();
    }
  });

  $("input[name='recoveryToken']").addEventListener("input", (event) => {
    event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
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
    const recoveryToken = String(values.get("recoveryToken") || "").trim();
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
      if (state.forgotStage === "request") {
        if (!email) throw { messageKey: "auth.required" };
        await sendRecoveryCode(email);
        return;
      }
      if (state.forgotStage === "verify") {
        if (!/^\d{6}$/.test(recoveryToken)) throw { messageKey: "auth.otpFormat" };
        await verifyRecoveryOtp({ email: state.recoveryEmail, token: recoveryToken });
        stopResendCountdown();
        state.forgotStage = "password";
        $("input[name='recoveryToken']").value = "";
        renderView();
        showMessage("auth.otpVerified", "success");
        return;
      }
      if (newPassword.length < 6) throw { messageKey: "auth.weakPassword" };
      if (newPassword !== confirmPassword) throw { messageKey: "auth.passwordMismatch" };
      await updatePassword(newPassword);
      await signOut();
      state.recoveryLink = false;
      clearRecoveryUrl();
      setView("login");
      showMessage("auth.passwordUpdated", "success");
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
          if (state.recoveryLink && state.view === "forgot" && state.forgotStage === "password") {
            $("input[name='email']").value = session.user.email || "";
          } else if (state.recoveryLink) {
            await signOut();
            state.recoveryLink = false;
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
