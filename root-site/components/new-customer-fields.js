const fields = ["name", "phone", "email", "carModel", "imei"];

const placeholders = {
  zh: {
    name: "請輸入姓名",
    phone: "請輸入聯絡電話",
    email: "example@email.com",
    carModel: "請輸入車型",
    imei: "請輸入產品IMEI碼",
    address: "請輸入運送地址"
  },
  en: {
    name: "Enter a name",
    phone: "Enter a phone number",
    email: "example@email.com",
    carModel: "Enter a vehicle model",
    imei: "Enter a product IMEI",
    address: "Enter a shipping address"
  },
  fr: {
    name: "Saisissez un nom",
    phone: "Saisissez un numéro de téléphone",
    email: "example@email.com",
    carModel: "Saisissez un modèle de véhicule",
    imei: "Saisissez l’IMEI du produit",
    address: "Saisissez une adresse de livraison"
  }
};

function inputType(key) {
  if (key === "phone") return "tel";
  if (key === "email") return "email";
  return "text";
}

function autocomplete(key) {
  if (key === "name") return "name";
  if (key === "phone") return "tel";
  if (key === "email") return "email";
  return "off";
}

export function renderNewCustomerFields({ lang, escapeHtml, label, idPrefix, disabled = false, values = {} }) {
  const text = placeholders[lang] ?? placeholders.zh;
  const disabledAttributes = disabled ? ' disabled aria-disabled="true"' : "";
  const renderField = (key) => {
    const id = `${idPrefix}-${key}`;
    const valueAttribute = values[key] == null || values[key] === "" ? "" : ` value="${escapeHtml(values[key])}"`;
    return `<div class="form-new-customer__field">
      <label class="form-new-customer__label" for="${escapeHtml(id)}">${escapeHtml(label(key))}</label>
      <input class="form-new-customer__value" id="${escapeHtml(id)}" name="${escapeHtml(key)}" type="${inputType(key)}" autocomplete="${autocomplete(key)}" data-new-customer-field="${escapeHtml(key)}"${valueAttribute} placeholder="${escapeHtml(text[key])}"${disabledAttributes}>
    </div>`;
  };
  const [name, phone, ...stacked] = fields;
  const addressId = `${idPrefix}-address`;
  return `<div class="form-new-customer__row">${renderField(name)}${renderField(phone)}</div>
    ${stacked.map(renderField).join("")}
    <div class="form-new-customer__field">
      <label class="form-new-customer__address-label" for="${escapeHtml(addressId)}">${escapeHtml(label("address"))}</label>
      <textarea class="form-new-customer__address" id="${escapeHtml(addressId)}" name="address" autocomplete="street-address" data-new-customer-field="address" placeholder="${escapeHtml(text.address)}"${disabledAttributes}>${escapeHtml(values.address ?? "")}</textarea>
    </div>`;
}
