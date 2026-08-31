import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createDebouncedTask } from "../root-site/components/debounced-task.js";
import { taskMatchesSearch } from "../root-site/team/tasks.js";

const callbacks = new Map();
let timerId = 0;
let renders = 0;
const debounce = createDebouncedTask(() => { renders += 1; }, {
  delay: 200,
  scheduleTimeout(callback, delay) {
    assert.equal(delay, 200);
    const id = ++timerId;
    callbacks.set(id, callback);
    return id;
  },
  cancelTimeout(id) {
    callbacks.delete(id);
  }
});
debounce.schedule();
debounce.schedule();
debounce.schedule();
assert.equal(callbacks.size, 1, "continuous typing must keep one trailing render");
callbacks.values().next().value();
assert.equal(renders, 1, "the result region must render once after typing stops");

const task = {
  title: "Prepare August invoice",
  note: "Call the wholesale customer",
  creator: "Helen",
  due: "2026/08/21",
  visibility: { department: "Finance" },
  assignees: [{ name: "Alice Wong" }],
  feedback: [{ author: "Bob", body: "Waiting for receipt" }],
  subtasks: [{ title: "Check receipt", note: "PO-0819" }]
};
for (const query of ["invoice", "alice", "finance", "waiting", "PO0819"]) {
  assert.equal(taskMatchesSearch(task, query), true, `task search must match ${query}`);
}
assert.equal(taskMatchesSearch(task, "not-present"), false);

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [orders, customers, tasks, taskBoard, taskI18n] = await Promise.all([
  read("root-site/bizflow/orders.js"),
  read("root-site/bizflow/customers.js"),
  read("root-site/team/tasks.js"),
  read("root-site/team/tasks-board.js"),
  read("root-site/team/tasks-i18n.js")
]);

const ordersInput = orders.slice(orders.indexOf("function onOrdersInput"), orders.indexOf("function onOrdersKeydown"));
assert.match(ordersInput, /ordersSearchRender\?\.schedule\(\)/);
assert.doesNotMatch(ordersInput, /rerenderOrdersPage|outerHTML/,
  "order typing must not replace the page or toolbar");
assert.match(orders, /function rerenderOrderSearchResults[\s\S]*\[data-orders-search-results\][\s\S]*results\.outerHTML = renderOrderResults/);

const customerSearch = customers.slice(customers.indexOf("const customerSearch ="), customers.indexOf("const search =", customers.indexOf("const customerSearch =")));
assert.match(customerSearch, /customersSearchRender\?\.schedule\(\)/);
assert.doesNotMatch(customerSearch, /rerenderCustomersPage|outerHTML/,
  "customer typing must not replace the page, filters or input");
assert.match(customers, /function rerenderCustomerSearchResults[\s\S]*\[data-customers-search-results\][\s\S]*results\.outerHTML = rendered\.list/);

const taskInput = tasks.slice(tasks.indexOf("function onTaskInput"), tasks.indexOf("const aiText", tasks.indexOf("function onTaskInput")));
assert.match(taskInput, /taskSearchRender\?\.schedule\(\)/);
assert.doesNotMatch(taskInput, /rerenderTaskPage|outerHTML/,
  "task typing must keep the toolbar and search input mounted");
assert.match(tasks, /function rerenderTaskSearchResults[\s\S]*results\.innerHTML = taskSearchSurface/);
const realtimeBlock = tasks.slice(tasks.indexOf("function hasTaskRealtimeRefreshBlock"), tasks.indexOf("function currentTaskViewState"));
assert.match(realtimeBlock, /\[data-task-search\]/,
  "realtime refresh must defer while the task search input is active");
const realtimeViewState = tasks.slice(tasks.indexOf("function currentTaskViewState"), tasks.indexOf("function applyRealtimeTaskData"));
assert.match(realtimeViewState, /search: filterState\.search/,
  "realtime task data must restore the live search term instead of clearing it");
assert.match(taskBoard, /data-task-search/);
for (const language of ["zh", "en", "fr"]) {
  assert.match(taskI18n, new RegExp(`${language}: \\{[\\s\\S]*?"tasks.search":`), `${language} task search copy must exist`);
}

console.log("Partial search contracts: PASS (200ms debounce, local result DOM, three-page focus-safe handlers)");
