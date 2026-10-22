(() => {
  "use strict";

  /*
   * secure.amiami.com is a Nuxt (Vue) single-page app. Switching between the
   * order tabs, or arriving from My Page, swaps the list in place without a
   * page load, so instead of initializing once we watch the DOM and re-apply
   * the controls, date formatting and current sort whenever AmiAmi re-renders.
   */

  const BILL_PATH = /^\/eng\/bill(\/|$)/;
  const LIST_SELECTOR = ".order-list";
  const ITEM_SELECTOR = ".order-list__item";
  const LABEL_SELECTOR = ".order-list__item_label";
  const DATE_SELECTOR = ".order-list__item_schedule__date";
  const PRICE_SELECTOR = ".order-list__item_price";
  const CONTROLS_CLASS = "amiami-order-sorter";
  const GROUP_CLASS = "amiami-month-group-start";
  const LINK_CLASS = "amiami-order-link";
  const STORAGE_KEY = "amiamiOrderSort";
  const SHUTDOWN_EVENT = "amiami-order-sorter:shutdown";
  const REFRESH_DELAY = 100;

  const MONTHS = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];

  // Relative labels AmiAmi uses instead of a date, as an offset from the
  // current month. "Before Last Month" sorts just ahead of "Last Month".
  const RELATIVE_MONTHS = {
    beforelastmonth: -2,
    lastmonth: -1,
    thismonth: 0,
    nextmonth: 1
  };

  const FIELDS = {
    date: "Release date",
    price: "Price"
  };

  let currentSort = { field: null, direction: null };
  let controls = null;
  let refreshTimer = null;
  let stopped = false;

  // Position each card had when AmiAmi rendered it, so "Reset" can restore
  // the site's own order and equal values keep a stable order.
  const originalIndex = new WeakMap();
  let nextOriginalIndex = 0;

  const observer = new MutationObserver(scheduleRefresh);

  /* ---------- Parsing ---------- */

  // Returns a sortable month number (year * 12 + month), or null.
  function parseReleaseMonth(text) {
    const value = (text || "").trim().replace(/\s+/g, "").toLowerCase();

    let match = value.match(/^(\d{4})\/(\d{1,2})(?:\/\d{1,2})?$/);
    if (match) {
      return Number(match[1]) * 12 + Number(match[2]) - 1;
    }

    match = value.match(/^([a-z]+)-(\d{4})$/);
    if (match) {
      const month = MONTHS.indexOf(match[1].slice(0, 3));
      if (month !== -1) {
        return Number(match[2]) * 12 + month;
      }
    }

    if (Object.prototype.hasOwnProperty.call(RELATIVE_MONTHS, value)) {
      const now = new Date();
      return now.getFullYear() * 12 + now.getMonth() + RELATIVE_MONTHS[value];
    }

    return null;
  }

  function formatMonth(month) {
    return Math.floor(month / 12) + "/" + (month % 12 + 1);
  }

  // Only rewrite month-only dates ("Nov-2026", "2026/03"); anything with a
  // day or an unknown format is left exactly as AmiAmi wrote it.
  function normalizeReleaseDate(text) {
    const value = (text || "").trim();
    if (!/^(\d{4}\/\d{1,2}|[A-Za-z]+-\d{4})$/.test(value.replace(/\s+/g, ""))) {
      return null;
    }

    const month = parseReleaseMonth(value);
    return month === null ? null : formatMonth(month);
  }

  function parsePrice(text) {
    const match = (text || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function getText(item, selector) {
    const element = item.querySelector(selector);
    return element ? element.textContent : "";
  }

  function getOrderNumber(item) {
    const match = getText(item, LABEL_SELECTOR).match(/(\d+)/);
    return match ? match[1] : null;
  }

  function getLinkOrderNumber(anchor) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/[?&]d_no=(\d+)/);
    return match ? match[1] : null;
  }

  /* ---------- DOM lookup ---------- */

  function isBillPage() {
    return BILL_PATH.test(location.pathname);
  }

  function getItems(list) {
    return Array.from(list.querySelectorAll(ITEM_SELECTOR));
  }

  // The direct child of the list that holds a card. Usually the card itself,
  // but other extensions (e.g. AmiAmi Embiggener) wrap each card in a link.
  function getUnit(list, item) {
    let unit = item;
    while (unit.parentElement && unit.parentElement !== list) {
      unit = unit.parentElement;
    }
    return unit.parentElement === list ? unit : null;
  }

  // The order list is the .order-list with the most cards in it.
  function findList() {
    let best = null;
    let bestCount = 0;

    document.querySelectorAll(LIST_SELECTOR).forEach(list => {
      const count = getItems(list).length;
      if (count > bestCount) {
        best = list;
        bestCount = count;
      }
    });

    return best;
  }

  function collectOrders(list) {
    // A link-wrapping extension can also leave an empty link to an order
    // directly in the list. Pair those with their card by order number so
    // they move together.
    const anchorsByOrder = new Map();
    Array.from(list.children).forEach(child => {
      if (child.tagName !== "A" || child.querySelector(ITEM_SELECTOR)) return;

      const orderNumber = getLinkOrderNumber(child);
      if (orderNumber) {
        anchorsByOrder.set(orderNumber, child);
      }
    });

    const orders = [];
    getItems(list).forEach(item => {
      const unit = getUnit(list, item);
      if (!unit) return;

      if (!originalIndex.has(item)) {
        originalIndex.set(item, nextOriginalIndex++);
      }

      const orderNumber = getOrderNumber(item);
      orders.push({
        item,
        unit,
        anchor: orderNumber ? anchorsByOrder.get(orderNumber) || null : null,
        original: originalIndex.get(item)
      });
    });

    return orders;
  }

  /* ---------- Page updates ---------- */

  function getDetailUrl(orderNumber) {
    const lang = location.pathname.split("/")[1] || "eng";
    return "/" + lang + "/bill/2?d_no=" + orderNumber;
  }

  // AmiAmi opens an order with a click handler, not a link, so cards can't be
  // middle-clicked or opened in a new tab. Wrap each card in a real link.
  // Cards another extension already wrapped are left as they are.
  function ensureLinks(list) {
    list.querySelectorAll(":scope > a." + LINK_CLASS).forEach(link => {
      if (!link.querySelector(ITEM_SELECTOR)) link.remove();
    });

    getItems(list).forEach(item => {
      const orderNumber = getOrderNumber(item);
      if (!orderNumber) return;

      const href = getDetailUrl(orderNumber);
      const parent = item.parentElement;

      if (parent.tagName === "A") {
        // AmiAmi can reuse a card for a different order; keep our link current.
        if (parent.classList.contains(LINK_CLASS) &&
            parent.getAttribute("href") !== href) {
          parent.setAttribute("href", href);
        }
        return;
      }

      if (parent !== list) return;

      const link = document.createElement("a");
      link.className = LINK_CLASS;
      link.href = href;
      list.insertBefore(link, item);
      link.appendChild(item);
    });
  }

  // Plain clicks keep AmiAmi's own in-page navigation instead of reloading.
  // Ctrl/Cmd/Shift-clicks open the link the browser's way without AmiAmi
  // also navigating this tab. Middle-clicks never reach AmiAmi's handler.
  function onOrderLinkClick(event) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;

    const link = event.target.closest(LIST_SELECTOR + " a[href*='d_no=']");
    if (!link || !link.querySelector(ITEM_SELECTOR)) return;

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.stopPropagation();
    } else {
      event.preventDefault();
    }
  }

  // Update the existing text node rather than replacing it: Vue keeps a
  // reference to that node and writes later updates into it.
  function setText(element, text) {
    const node = element.firstChild;
    if (node && node === element.lastChild && node.nodeType === Node.TEXT_NODE) {
      node.data = text;
    } else {
      element.textContent = text;
    }
  }

  function normalizeDates(orders) {
    orders.forEach(({ item }) => {
      const element = item.querySelector(DATE_SELECTOR);
      if (!element) return;

      const normalized = normalizeReleaseDate(element.textContent);
      if (normalized && element.textContent.trim() !== normalized) {
        setText(element, normalized);
      }
    });
  }

  function getSortValue(item, field) {
    if (field === "date") return parseReleaseMonth(getText(item, DATE_SELECTOR));
    if (field === "price") return parsePrice(getText(item, PRICE_SELECTOR));
    return null;
  }

  function applyOrder(list, orders) {
    if (orders.length < 2) return;

    const { field, direction } = currentSort;

    orders.forEach(order => {
      order.value = field ? getSortValue(order.item, field) : null;
    });

    const sorted = orders.slice().sort((a, b) => {
      if (field && a.value !== b.value) {
        // Orders without a usable value always go last.
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return direction === "desc" ? b.value - a.value : a.value - b.value;
      }
      return a.original - b.original;
    });

    const desired = [];
    sorted.forEach(order => {
      if (order.anchor) desired.push(order.anchor);
      desired.push(order.unit);
    });

    const desiredSet = new Set(desired);
    const current = Array.from(list.children).filter(child =>
      desiredSet.has(child)
    );

    if (current.every((node, index) => node === desired[index])) return;

    // Re-insert the cards where the block of cards already sits, so any
    // other children of the list (headers, pagination) keep their place.
    const marker = current[current.length - 1].nextSibling;
    const fragment = document.createDocumentFragment();
    desired.forEach(node => fragment.appendChild(node));
    list.insertBefore(fragment, marker);
  }

  // Draw a divider whenever the release month changes. Not meaningful when
  // sorted by price, so it's turned off there.
  function markMonthGroups(list) {
    const enabled = currentSort.field !== "price";
    let previousMonth = null;

    getItems(list).forEach(item => {
      const month = parseReleaseMonth(getText(item, DATE_SELECTOR));

      item.classList.toggle(
        GROUP_CLASS,
        enabled && month !== null && month !== previousMonth
      );

      previousMonth = month;
    });
  }

  /* ---------- Controls ---------- */

  function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "amiami-sort-button";
    button.textContent = label;

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });

    return button;
  }

  function buildControls() {
    const container = document.createElement("div");
    container.className = CONTROLS_CLASS;

    const title = document.createElement("span");
    title.className = "amiami-sort-title";
    title.textContent = "Sort orders:";
    container.appendChild(title);

    Object.keys(FIELDS).forEach(field => {
      const button = createButton(FIELDS[field], () => cycleSort(field));
      button.dataset.sortField = field;
      button.title = "Click again to reverse the order";
      container.appendChild(button);
    });

    const reset = createButton("Reset", () => setSort(null, null));
    reset.classList.add("amiami-sort-reset");
    reset.title = "Restore AmiAmi's original order";
    container.appendChild(reset);

    return container;
  }

  function ensureControls(list) {
    if (!controls) controls = buildControls();

    if (controls.parentNode !== list.parentNode ||
        controls.nextElementSibling !== list) {
      list.parentNode.insertBefore(controls, list);
    }
  }

  function updateButtons() {
    if (!controls) return;

    controls.querySelectorAll("[data-sort-field]").forEach(button => {
      const field = button.dataset.sortField;
      const active = currentSort.field === field;
      const arrow = currentSort.direction === "asc" ? " ↑" : " ↓";

      button.textContent = FIELDS[field] + (active ? arrow : "");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    controls.querySelector(".amiami-sort-reset").hidden = !currentSort.field;
  }

  /* ---------- Sort state ---------- */

  function cycleSort(field) {
    const direction =
      currentSort.field === field && currentSort.direction === "asc"
        ? "desc"
        : "asc";
    setSort(field, direction);
  }

  function setSort(field, direction) {
    currentSort = { field, direction };
    saveSort();
    refresh();
  }

  function loadSort() {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get(STORAGE_KEY, result => {
          const saved = result && result[STORAGE_KEY];
          if (saved && FIELDS[saved.field] &&
              (saved.direction === "asc" || saved.direction === "desc")) {
            currentSort = { field: saved.field, direction: saved.direction };
          }
          resolve();
        });
      } catch (error) {
        resolve();
      }
    });
  }

  function saveSort() {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: currentSort });
    } catch (error) {
      // Storage is unavailable (e.g. the extension was reloaded); the sort
      // still applies for this page, it just won't be remembered.
    }
  }

  /* ---------- Refresh loop ---------- */

  function observe() {
    if (stopped) return;

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(refresh, REFRESH_DELAY);
  }

  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    if (stopped) return;

    // Pause the observer so our own DOM changes don't trigger another pass.
    observer.disconnect();

    try {
      const list = isBillPage() ? findList() : null;

      if (!list) {
        if (controls) controls.remove();
        return;
      }

      ensureLinks(list);

      const orders = collectOrders(list);

      ensureControls(list);
      normalizeDates(orders);
      applyOrder(list, orders);
      markMonthGroups(list);
      updateButtons();
    } finally {
      observe();
    }
  }

  function stop() {
    stopped = true;
    observer.disconnect();
    clearTimeout(refreshTimer);
    document.removeEventListener("click", onOrderLinkClick, true);
    if (controls) controls.remove();
  }

  function start() {
    // If the extension was reloaded, an older copy of this script may still
    // be running in the page. Tell it to step aside before taking over.
    document.dispatchEvent(new CustomEvent(SHUTDOWN_EVENT));
    document.addEventListener(SHUTDOWN_EVENT, stop, { once: true });
    document.addEventListener("click", onOrderLinkClick, true);

    loadSort().then(() => {
      refresh();
      window.addEventListener("popstate", scheduleRefresh);
    });
  }

  start();
})();
