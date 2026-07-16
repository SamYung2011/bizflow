import { memberT } from "./members-i18n.js";

function renderReviewCard(review, data, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const departmentOptions = data.form.departments.map((department) => {
    const value = typeof department === "string" ? department : department.id;
    const label = typeof department === "string" ? tt(`members.dept.${department}`) : department.name;
    return `<option value="${escapeHtml(value)}"${value === review.dept ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  const roleOptions = data.form.roles.map((role) => {
    const value = typeof role === "string" ? role : role.id;
    const label = typeof role === "string" ? tt(`members.role.${role}`) : role.name;
    return `<option value="${escapeHtml(value)}"${value === review.role ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
  return `<form class="tp-component review-card" data-member-review-card="${escapeHtml(review.id)}">
    <div class="review-card__identity">
      <div class="review-card__person">
        <span class="avatar--initial review-card__avatar" aria-hidden="true">${escapeHtml(review.name.trim().charAt(0).toUpperCase() || "?")}</span>
        <div class="review-card__person-copy">
          <h2 title="${escapeHtml(review.name)}">${escapeHtml(review.name)}</h2>
          <span title="${escapeHtml(review.email)}">${escapeHtml(tt("members.detail.email"))}: ${escapeHtml(review.email)}</span>
          <span>${escapeHtml(tt("members.detail.joinedAt"))}: ${escapeHtml(review.appliedAt)}</span>
        </div>
      </div>
      <span class="review-card__application">${escapeHtml(tt("members.review.application"))}</span>
    </div>
    <div class="review-card__fields">
      <label class="review-card__field">
        <span>${escapeHtml(tt("members.review.position"))}</span>
        <input name="position" value="${escapeHtml(review.position)}"${state.liveReadOnly ? " disabled" : ""}>
      </label>
      <label class="review-card__field">
        <span>${escapeHtml(tt("members.review.department"))}</span>
        <select name="dept"${state.liveReadOnly ? " disabled" : ""}>${departmentOptions}</select>
      </label>
      <label class="review-card__field">
        <span>${escapeHtml(tt("members.review.permission"))}</span>
        <select name="role"${state.liveReadOnly ? " disabled" : ""}>${roleOptions}</select>
      </label>
      <div class="review-card__actions">
        <button type="button" class="review-card__button review-card__button--reject" data-member-review-reject${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.review.reject"))}</button>
        <button type="submit" class="review-card__button review-card__button--approve"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.review.approve"))}</button>
      </div>
    </div>
  </form>`;
}

export function renderMemberReviews({ state, data, helpers }) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const registration = state.reviewMode === "registration";
  const pending = registration ? state.reviews : state.joinPending;
  const history = registration ? state.reviewHistory : state.joinHistory;
  const pendingBody = registration
    ? state.reviews.map((review) => renderReviewCard(review, data, state, helpers)).join("")
    : state.joinPending.map((review) => renderJoinPendingCard(review, state, helpers)).join("");
  return `<section class="member-review-domain" data-member-review-domain data-review-active-mode="${registration ? "registration" : "join"}" data-review-pending-count="${pending.length}" data-review-history-count="${history.length}">
    <div class="member-review-domain__tabs" role="tablist">
      ${["registration", "join"].map((mode) => `<button type="button" class="tab-chip${state.reviewMode === mode ? " tab-chip--active" : ""}" data-review-mode="${mode}" role="tab" aria-selected="${state.reviewMode === mode}">${escapeHtml(tt(`members.review.mode.${mode}`))}</button>`).join("")}
    </div>
    <section class="member-review-domain__section">
      <h2>${escapeHtml(tt("members.review.pending"))}</h2>
      ${pending.length ? `<div class="team-members-reviews">${pendingBody}</div>` : `<div class="team-members-empty">${escapeHtml(tt(registration ? "members.review.empty" : "members.review.joinEmpty"))}</div>`}
    </section>
    <section class="member-review-domain__section">
      <h2>${escapeHtml(tt("members.review.recent"))}</h2>
      <div class="member-review-history">${history.map((review) => renderReviewHistory(review, registration, helpers)).join("")}</div>
    </section>
  </section>`;
}

function statusPill(approved, helpers) {
  const { escapeHtml, lang } = helpers;
  return `<span class="member-review-status member-review-status--${approved ? "approved" : "rejected"}">${escapeHtml(memberT(lang, approved ? "members.review.approved" : "members.review.rejected"))}</span>`;
}

function renderReviewHistory(review, registration, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  const name = registration ? review.name : review.employee;
  const company = registration ? review.companyName : review.company;
  const note = registration ? review.rejectReason : (review.rejectReason || review.note);
  return `<article class="member-review-history__row" data-review-history-id="${escapeHtml(review.id)}">
    <div class="member-review-history__identity"><strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>${registration ? `<span title="${escapeHtml(review.email)}">${escapeHtml(review.email)}</span>` : ""}</div>
    <span title="${escapeHtml(company)}">${escapeHtml(company)}</span>
    <span>${escapeHtml(review.appliedAt || "—")} → ${escapeHtml(review.reviewedAt || "—")}</span>
    ${statusPill(review.approved, helpers)}
    <span class="member-review-history__note" title="${escapeHtml(note || tt("members.review.noNote"))}">${escapeHtml(note || tt("members.review.noNote"))}</span>
  </article>`;
}

function renderJoinPendingCard(review, state, helpers) {
  const { escapeHtml, lang } = helpers;
  const tt = (key) => memberT(lang, key);
  return `<article class="member-review-join-pending" data-join-review-card="${escapeHtml(review.id)}">
    <div><strong>${escapeHtml(review.employee || review.name || "—")}</strong><span>${escapeHtml(review.company || "—")}</span><time>${escapeHtml(review.appliedAt || "—")}</time></div>
    <p>${escapeHtml(review.note || tt("members.review.noNote"))}</p>
    <div><button type="button" class="review-card__button review-card__button--reject" data-join-review-action="reject"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.review.reject"))}</button><button type="button" class="review-card__button review-card__button--approve" data-join-review-action="approve"${state.liveReadOnly ? " disabled" : ""}>${escapeHtml(tt("members.review.approve"))}</button></div>
  </article>`;
}

export function attachMemberReviewController({ state, rerender, scope }) {
  // 现网批准/拒绝会写审核表；静态复刻只在真实 pending 出现时提供本地演示动作。
  scope.listen(document, "click", (event) => {
    const mode = event.target.closest("button[data-review-mode]");
    if (mode) {
      state.reviewMode = mode.getAttribute("data-review-mode") === "join" ? "join" : "registration";
      rerender();
      return;
    }
    const action = event.target.closest("[data-join-review-action]");
    const card = action?.closest("[data-join-review-card]");
    if (!action || !card || state.liveReadOnly || !state.access.canApproveRegistration) return;
    const review = state.joinPending.find((item) => item.id === card.getAttribute("data-join-review-card"));
    if (!review) return;
    state.joinPending = state.joinPending.filter((item) => item.id !== review.id);
    state.joinHistory.unshift({
      ...review,
      reviewedAt: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "/"),
      approved: action.getAttribute("data-join-review-action") === "approve",
      rejectReason: action.getAttribute("data-join-review-action") === "reject" ? review.rejectReason || "" : ""
    });
    state.summary.reviewPending = state.reviews.length + state.joinPending.length;
    rerender();
  });
}
