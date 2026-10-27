/* Trợ giúp dùng chung cho sidebar: nội dung nằm trong data-help, không chen vào nhãn nút. */
(function (root) {
  "use strict";

  function mount(doc) {
    const bubble = doc.getElementById("viewer-help-tooltip");
    const buttons = Array.from(doc.querySelectorAll("[data-help]"));
    let current = null,
      pinned = false,
      focused = false,
      timer;

    // Tooltip đặt ngoài panel có overflow:auto để không bị cắt khi nằm sát mép sidebar.
    function position(button) {
      const viewportWidth = doc.documentElement.clientWidth;
      const viewportHeight = doc.documentElement.clientHeight;
      bubble.style.maxWidth = `${Math.min(280, viewportWidth - 24)}px`;
      const anchor = button.getBoundingClientRect();
      const size = bubble.getBoundingClientRect();
      bubble.style.left = `${Math.max(12, Math.min(anchor.right - size.width, viewportWidth - size.width - 12))}px`;
      const below = anchor.bottom + 8;
      const above = anchor.top - size.height - 8;
      // Ưu tiên phía trên để không che nút Vẽ/Hoàn tất ngay dưới tiêu đề.
      bubble.style.top = `${Math.max(12, above >= 12 ? above : Math.min(below, viewportHeight - size.height - 12))}px`;
    }

    function close() {
      clearTimeout(timer);
      current?.removeAttribute("aria-describedby");
      current = null;
      pinned = false;
      focused = false;
      bubble.hidden = true;
    }

    function show(button) {
      clearTimeout(timer);
      if (current && current !== button) {
        current.removeAttribute("aria-describedby");
        pinned = false;
        focused = false;
      }
      current = button;
      // Chỉ dùng textContent: tooltip không diễn giải HTML hoặc nhận markup từ dữ liệu.
      bubble.textContent = button.getAttribute("data-help");
      bubble.hidden = false;
      button.setAttribute("aria-describedby", bubble.id);
      position(button);
    }

    // Khoảng trễ ngắn cho phép đưa chuột từ icon sang tooltip mà nội dung không biến mất.
    function leave() {
      if (!pinned && !focused) timer = setTimeout(close, 140);
    }

    for (const button of buttons) {
      button.addEventListener("pointerenter", () => show(button));
      button.addEventListener("pointerleave", leave);
      button.addEventListener("focus", () => {
        show(button);
        focused = true;
      });
      button.addEventListener("blur", close);
      // Bấm để ghim/đóng cho màn hình cảm ứng; không dựa riêng vào hover hay title của browser.
      button.addEventListener("click", () => {
        if (current === button && pinned) close();
        else {
          show(button);
          pinned = true;
        }
      });
    }
    bubble.addEventListener("pointerenter", () => clearTimeout(timer));
    bubble.addEventListener("pointerleave", leave);
    doc.addEventListener("pointerdown", (event) => {
      if (
        current &&
        !current.contains(event.target) &&
        !bubble.contains(event.target)
      )
        close();
    });
    // Esc chỉ đóng trợ giúp trước; không vô tình hủy tuyến/vùng đang vẽ phía dưới.
    doc.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && current) {
          close();
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    // Panel đổi vị trí khi cuộn/resize: đóng tooltip để không để lại chú thích trôi trên bản đồ.
    doc.addEventListener("scroll", close, true);
    root.addEventListener?.("resize", close);
    return { close };
  }

  const api = { mount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerHelp = api;
})(typeof window !== "undefined" ? window : globalThis);
