const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { mount } = require("../viewer-help.js");

// Kiểm contract tương tác, không thay cho kiểm layout/hover thật trong browser.
function fixture() {
  class Element extends EventTarget {
    attrs = {};
    hidden = true;
    style = {};
    textContent = "";
    setAttribute(k, v) {
      this.attrs[k] = v;
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    contains(node) {
      return node === this;
    }
    getBoundingClientRect() {
      return {
        left: 285,
        right: 313,
        top: 220,
        bottom: 248,
        width: 240,
        height: 60,
      };
    }
  }
  const first = new Element(),
    second = new Element(),
    bubble = new Element();
  first.attrs["data-help"] = "Bấm từ 2 điểm rồi Hoàn tất tuyến.";
  second.attrs["data-help"] = "Khoanh vùng để xem nồng độ.";
  bubble.id = "viewer-help-tooltip";
  const doc = Object.assign(new EventTarget(), {
    getElementById: () => bubble,
    querySelectorAll: () => [first, second],
    documentElement: { clientWidth: 320, clientHeight: 260 },
  });
  const instance = mount(doc);
  return { first, second, bubble, doc, instance };
}
const fire = (el, type) =>
  el.dispatchEvent(new Event(type, { cancelable: true }));
const delay = () => new Promise((resolve) => setTimeout(resolve, 170));

test("hover shows short help and associates it with the triggering icon", () => {
  const { first, bubble } = fixture();
  fire(first, "pointerenter");
  assert.equal(bubble.hidden, false);
  assert.equal(bubble.textContent, "Bấm từ 2 điểm rồi Hoàn tất tuyến.");
  assert.equal(first.getAttribute("aria-describedby"), "viewer-help-tooltip");
});
test("tooltip remains readable while pointer moves from icon into the popup", async () => {
  const { first, bubble } = fixture();
  fire(first, "pointerenter");
  fire(first, "pointerleave");
  fire(bubble, "pointerenter");
  await delay();
  assert.equal(bubble.hidden, false);
  fire(bubble, "pointerleave");
  await delay();
  assert.equal(bubble.hidden, true);
});
test("focus opens help and blur dismisses without moving focus into tooltip", () => {
  const { first, bubble } = fixture();
  fire(first, "focus");
  assert.equal(bubble.hidden, false);
  fire(first, "blur");
  assert.equal(bubble.hidden, true);
  assert.equal(first.getAttribute("aria-describedby"), null);
});
test("Escape consumes the help dismissal instead of canceling a drawing behind it", () => {
  const { first, bubble, doc } = fixture();
  let canceledDrawing = false;
  doc.addEventListener("keydown", () => (canceledDrawing = true));
  fire(first, "focus");
  const event = new Event("keydown", { cancelable: true });
  Object.defineProperty(event, "key", { value: "Escape" });
  doc.dispatchEvent(event);
  assert.equal(bubble.hidden, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(canceledDrawing, false);
});
test("touch click pins help, a second click or outside tap dismisses it", async () => {
  const { first, bubble, doc } = fixture();
  fire(first, "click");
  fire(first, "pointerleave");
  await delay();
  assert.equal(bubble.hidden, false);
  fire(first, "click");
  assert.equal(bubble.hidden, true);
  fire(first, "click");
  fire(doc, "pointerdown");
  assert.equal(bubble.hidden, true);
});
test("changing help removes the old description and scrolling dismisses a detached anchor", () => {
  const { first, second, bubble, doc } = fixture();
  fire(first, "pointerenter");
  fire(second, "pointerenter");
  assert.equal(first.getAttribute("aria-describedby"), null);
  assert.equal(bubble.textContent, "Khoanh vùng để xem nồng độ.");
  fire(doc, "scroll");
  assert.equal(bubble.hidden, true);
  assert.equal(second.getAttribute("aria-describedby"), null);
});
test("popup clamps to viewport edges and displays content as text", () => {
  const { first, bubble } = fixture();
  first.attrs["data-help"] = "<img src=x onerror=alert(1)>";
  fire(first, "pointerenter");
  assert.equal(bubble.textContent, first.attrs["data-help"]);
  assert.ok(parseFloat(bubble.style.left) >= 12);
  assert.ok(parseFloat(bubble.style.left) + 240 <= 308);
  assert.ok(parseFloat(bubble.style.top) >= 12);
  assert.ok(parseFloat(bubble.style.top) + 60 <= 248);
});
test("feature explanations use short accessible info icons and no persistent instruction paragraphs", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const help = [
    ...html.matchAll(
      /<button\b([^>]*?)data-help="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g,
    ),
  ];
  assert.ok(help.length >= 12);
  for (const [, before, text, after, content] of help) {
    assert.match(before + after, /aria-label="[^"]+"/);
    assert.ok(text.length <= 160, text);
    assert.match(content, /bi-info-circle/);
    assert.doesNotMatch(content, /<svg|😀/);
  }
  assert.doesNotMatch(html, /<p class="(?:instruction|field-help)">/);
  assert.match(html, /id="viewer-help-tooltip"[^>]*role="tooltip"[^>]*hidden/);
});
