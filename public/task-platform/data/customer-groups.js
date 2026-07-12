// Mirrors bizflow_samyung/src/context/AppContext.jsx:168-352.
// Rule 1 is virtual union-find; rule 2 is the existing parent_id physical merge.

const FIELDS = [
  { key: "name", multi: false, fuzzy: false },
  { key: "phone", multi: true, fuzzy: false },
  { key: "phone_mainland", multi: true, fuzzy: false },
  { key: "email", multi: true, fuzzy: true },
  { key: "address", multi: true, fuzzy: true }
];

function norm(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function editDist1(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (++edits > 1) return false;
    if (la === lb) {
      i += 1;
      j += 1;
    } else if (la > lb) i += 1;
    else j += 1;
  }
  if (i < la || j < lb) edits += 1;
  return edits <= 1;
}

function splitLines(value, lower = false) {
  return String(value || "").split(/\n+/).map((line) => {
    const trimmed = line.trim();
    return lower ? trimmed.toLocaleLowerCase() : trimmed;
  }).filter(Boolean);
}

function fieldMatch(field, left, right) {
  if (!field.multi) {
    const a = norm(left[field.key]);
    const b = norm(right[field.key]);
    return Boolean(a) && a === b;
  }
  const a = splitLines(left[field.key], true);
  const b = splitLines(right[field.key], true);
  if (!a.length || !b.length) return false;
  return a.some((x) => b.some((y) => field.fuzzy ? editDist1(x, y) : x === y));
}

function absorb(info, customer) {
  const name = String(customer.name || "").trim();
  if (name) info.names.add(name);
  splitLines(customer.phone).forEach((value) => info.phones.add(value));
  splitLines(customer.email).forEach((value) => info.emails.add(value));
  splitLines(customer.address).forEach((value) => info.addresses.add(value));
  splitLines(customer.phone_mainland).forEach((value) => info.phoneMainlands.add(value));
  splitLines(customer.car_make).forEach((value) => info.carMakes.add(value));
  splitLines(customer.car_model).forEach((value) => info.carModels.add(value));
}

export function buildCustomerGroups(customers) {
  const uniqueCustomers = [...new Map(customers.map((customer) => [customer.id, customer])).values()];
  const byId = new Map(uniqueCustomers.map((customer) => [customer.id, customer]));
  const childrenByParent = new Map();
  for (const customer of uniqueCustomers) {
    if (!customer.parent_id) continue;
    const children = childrenByParent.get(customer.parent_id) ?? [];
    children.push(customer);
    childrenByParent.set(customer.parent_id, children);
  }
  const independents = uniqueCustomers.filter((customer) => !customer.parent_id);
  const indexes = FIELDS.map(() => new Map());
  for (const customer of independents) {
    FIELDS.forEach((field, index) => {
      const values = field.multi ? splitLines(customer[field.key], true) : [norm(customer[field.key])].filter(Boolean);
      for (const value of values) {
        const ids = indexes[index].get(value) ?? [];
        ids.push(customer.id);
        indexes[index].set(value, ids);
      }
    });
  }

  const parent = new Map(independents.map((customer) => [customer.id, customer.id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  for (const customer of independents) {
    const candidates = new Set();
    FIELDS.forEach((field, index) => {
      const values = field.multi ? splitLines(customer[field.key], true) : [norm(customer[field.key])].filter(Boolean);
      values.forEach((value) => indexes[index].get(value)?.forEach((id) => {
        if (id !== customer.id) candidates.add(id);
      }));
    });
    for (const id of candidates) {
      const other = byId.get(id);
      if (!other) continue;
      const excludedByCustomer = Array.isArray(customer.merge_exclude) ? customer.merge_exclude : [];
      const excludedByOther = Array.isArray(other.merge_exclude) ? other.merge_exclude : [];
      if (excludedByCustomer.includes(other.id) || excludedByOther.includes(customer.id)) continue;
      const matches = FIELDS.filter((field) => fieldMatch(field, customer, other)).length;
      if (matches < 3) continue;
      const leftRoot = find(customer.id);
      const rightRoot = find(id);
      if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
    }
  }

  const groupInfo = new Map();
  for (const customer of independents) {
    const root = find(customer.id);
    if (!groupInfo.has(root)) {
      groupInfo.set(root, {
        cids: [], childCids: [], names: new Set(), phones: new Set(), emails: new Set(), addresses: new Set(),
        phoneMainlands: new Set(), carMakes: new Set(), carModels: new Set()
      });
    }
    const info = groupInfo.get(root);
    info.cids.push(customer.id);
    absorb(info, customer);
    for (const child of childrenByParent.get(customer.id) ?? []) {
      info.childCids.push(child.id);
      absorb(info, child);
    }
  }

  const rootToPrimary = new Map();
  for (const [root, info] of groupInfo) {
    const primaryId = info.cids.find((id) => String(byId.get(id)?.name || "").trim()) ?? info.cids[0];
    rootToPrimary.set(root, primaryId);
  }
  const idToGroup = new Map();
  for (const customer of independents) {
    const root = find(customer.id);
    idToGroup.set(customer.id, rootToPrimary.get(root) ?? root);
  }
  for (const customer of uniqueCustomers) {
    if (customer.parent_id && !idToGroup.has(customer.id)) {
      const mapped = idToGroup.get(customer.parent_id);
      if (mapped) idToGroup.set(customer.id, mapped);
    }
  }

  const groups = [];
  for (const [root, info] of groupInfo) {
    const id = rootToPrimary.get(root);
    const primary = byId.get(id) ?? {};
    const createdAt = info.cids.map((cid) => byId.get(cid)?.created_at).filter(Boolean).sort()[0] ?? "";
    groups.push({
      id,
      primary,
      cids: info.cids.slice(),
      childCids: info.childCids.slice(),
      allCids: [...info.cids, ...info.childCids],
      allNames: [...info.names],
      allPhones: [...info.phones],
      allEmails: [...info.emails],
      allAddresses: [...info.addresses],
      allPhoneMainlands: [...info.phoneMainlands],
      allCarMakes: [...info.carMakes],
      allCarModels: [...info.carModels],
      createdAt
    });
  }
  return { groups, idToGroup };
}
