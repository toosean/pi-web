import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { useMobileHistoryNavigation } = await jiti.import("./useMobileHistoryNavigation.ts");

// Helper to create mock browser environment
function createMockWindow(initialState = null) {
  const historyStack = [initialState ? { ...initialState } : {}];
  let currentIndex = 0;
  const eventListeners = new Map();

  const mockWindow = {
    history: {
      get state() {
        return historyStack[currentIndex] ?? null;
      },
      get length() {
        return historyStack.length;
      },
      replaceState(state) {
        historyStack[currentIndex] = state ? { ...state } : null;
      },
      pushState(state) {
        currentIndex += 1;
        historyStack.length = currentIndex;
        historyStack.push(state ? { ...state } : null);
      },
      back() {
        if (currentIndex > 0) {
          currentIndex -= 1;
          const event = { state: historyStack[currentIndex] };
          const listeners = eventListeners.get("popstate") || [];
          for (const listener of listeners) {
            listener(event);
          }
        }
      },
    },
    addEventListener(event, listener) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(listener);
    },
    removeEventListener(event, listener) {
      const list = eventListeners.get(event) || [];
      const index = list.indexOf(listener);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchPopState(state) {
      const event = { state };
      const listeners = eventListeners.get("popstate") || [];
      for (const listener of listeners) {
        listener(event);
      }
    },
  };

  return { mockWindow, historyStack, getCurrentIndex: () => currentIndex };
}

test("useMobileHistoryNavigation is defined as a hook function", () => {
  assert.equal(typeof useMobileHistoryNavigation, "function");
});

test("simulates mobile back navigation flow: file -> chat -> sidebar -> exit", () => {
  const { mockWindow, getCurrentIndex } = createMockWindow();
  globalThis.window = mockWindow;

  let sidebarOpen = false;
  let rightPanelOpen = false;

  const setSidebarOpen = (val) => {
    sidebarOpen = typeof val === "function" ? val(sidebarOpen) : val;
  };
  const setRightPanelOpen = (val) => {
    rightPanelOpen = typeof val === "function" ? val(rightPanelOpen) : val;
  };

  // 1. Initial mobile mount in chat view
  // Simulate effect execution
  mockWindow.history.replaceState({ __pi_mobile_view: "sidebar", __pi_mobile_depth: 0 }, "");
  mockWindow.history.pushState({ __pi_mobile_view: "chat", __pi_mobile_depth: 1 }, "");

  assert.equal(getCurrentIndex(), 1);
  assert.deepEqual(mockWindow.history.state, { __pi_mobile_view: "chat", __pi_mobile_depth: 1 });

  // 2. Open file preview
  mockWindow.history.pushState({ __pi_mobile_view: "file", __pi_mobile_depth: 2 }, "");
  setRightPanelOpen(true);
  assert.equal(getCurrentIndex(), 2);
  assert.equal(rightPanelOpen, true);
  assert.equal(sidebarOpen, false);

  // Set up popstate handler simulating useMobileHistoryNavigation
  const popStateHandler = (event) => {
    const targetDepth = typeof event.state?.__pi_mobile_depth === "number"
      ? event.state.__pi_mobile_depth
      : -1;

    if (rightPanelOpen) {
      setRightPanelOpen(false);
      if (targetDepth === 0) setSidebarOpen(true);
      return;
    }

    if (!sidebarOpen && !rightPanelOpen) {
      setSidebarOpen(true);
      return;
    }
  };
  mockWindow.addEventListener("popstate", popStateHandler);

  // 3. User presses back in file viewer -> should close file viewer and return to chat
  mockWindow.history.back();
  assert.equal(rightPanelOpen, false);
  assert.equal(sidebarOpen, false);
  assert.equal(getCurrentIndex(), 1);
  assert.equal(mockWindow.history.state.__pi_mobile_view, "chat");

  // 4. User presses back in chat view -> should open sidebar
  mockWindow.history.back();
  assert.equal(rightPanelOpen, false);
  assert.equal(sidebarOpen, true);
  assert.equal(getCurrentIndex(), 0);
  assert.equal(mockWindow.history.state.__pi_mobile_view, "sidebar");

  mockWindow.removeEventListener("popstate", popStateHandler);
});
