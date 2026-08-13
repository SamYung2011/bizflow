// 站内列表搜索的统一匹配口径:大小写不敏感 + 空格/横杠不敏感。
// 电话在 customers 表里存的是「9123 4567」「+852 9123 4567」这种带空格的写法(新增客户表单
// 的示例就是这么给的),使用者搜的时候习惯直接敲连号「91234567」,也有人照抄带空格的号码;
// 两个方向都得命中,所以除了原文 includes,再把两边的空格和横杠都压掉比一次。IMEI 同理。
// 客户列表(bizflow/customers.js)与保修提醒(bizflow/customers-warranty.js)共用这一份,
// 保修提醒原先是自己写的原文 includes,搜带空格的电话搜不到(todo #359),不再各写各的。

export function normalizeSearchText(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[\s-]+/g, "");
}

// values 允许嵌套数组(allPhones / imeiCodes 这类多值字段直接塞进来);
// null / undefined 一律跳过,不能让 String(undefined) 变成能被搜到的 "undefined"。
export function matchesSearchValues(values, query) {
  const term = normalizeSearchText(query);
  if (!term) return true;
  const compactTerm = compactSearchText(term);
  return values.flat().some((value) => {
    if (value == null) return false;
    const text = normalizeSearchText(value);
    if (!text) return false;
    return text.includes(term) || (compactTerm !== "" && compactSearchText(text).includes(compactTerm));
  });
}
