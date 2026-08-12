//#region ../../node_modules/.pnpm/string-dedent@3.0.2/node_modules/string-dedent/dist/dedent.mjs
var cache = /* @__PURE__ */ new WeakMap();
var newline = /(\n|\r\n?|\u2028|\u2029)/g;
var leadingWhitespace = /^\s*/;
var nonWhitespace = /\S/;
var slice = Array.prototype.slice;
var zero = "0".charCodeAt(0);
var nine = "9".charCodeAt(0);
var lowerA = "a".charCodeAt(0);
var lowerF = "f".charCodeAt(0);
var upperA = "A".charCodeAt(0);
var upperF = "F".charCodeAt(0);
function dedent(arg) {
	if (typeof arg === "string") return process([arg])[0];
	if (typeof arg === "function") return function() {
		const args = slice.call(arguments);
		args[0] = processTemplateStringsArray(args[0]);
		return arg.apply(this, args);
	};
	const strings = processTemplateStringsArray(arg);
	let s = getCooked(strings, 0);
	for (let i = 1; i < strings.length; i++) s += arguments[i] + getCooked(strings, i);
	return s;
}
function getCooked(strings, index) {
	const str = strings[index];
	if (str === void 0) throw new TypeError(`invalid cooked string at index ${index}`);
	return str;
}
function processTemplateStringsArray(strings) {
	const cached = cache.get(strings);
	if (cached) return cached;
	const raw = process(strings.raw);
	const cooked = raw.map(cook);
	Object.defineProperty(cooked, "raw", { value: Object.freeze(raw) });
	Object.freeze(cooked);
	cache.set(strings, cooked);
	return cooked;
}
function process(strings) {
	const splitQuasis = strings.map((quasi) => quasi.split(newline));
	let common;
	for (let i = 0; i < splitQuasis.length; i++) {
		const lines = splitQuasis[i];
		const firstSplit = i === 0;
		const lastSplit = i + 1 === splitQuasis.length;
		if (firstSplit) {
			if (lines.length === 1 || lines[0].length > 0) throw new Error("invalid content on opening line");
			lines[1] = "";
		}
		if (lastSplit) {
			if (lines.length === 1 || nonWhitespace.test(lines[lines.length - 1])) throw new Error("invalid content on closing line");
			lines[lines.length - 2] = "";
			lines[lines.length - 1] = "";
		}
		for (let j = 2; j < lines.length; j += 2) {
			const text = lines[j];
			const lineContainsTemplateExpression = j + 1 === lines.length && !lastSplit;
			const leading = leadingWhitespace.exec(text)[0];
			if (!lineContainsTemplateExpression && leading.length === text.length) {
				lines[j] = "";
				continue;
			}
			common = commonStart(leading, common);
		}
	}
	const min = common ? common.length : 0;
	return splitQuasis.map((lines) => {
		let quasi = lines[0];
		for (let i = 1; i < lines.length; i += 2) {
			const newline = lines[i];
			const text = lines[i + 1];
			quasi += newline + text.slice(min);
		}
		return quasi;
	});
}
function commonStart(a, b) {
	if (b === void 0 || a === b) return a;
	let i = 0;
	for (const len = Math.min(a.length, b.length); i < len; i++) if (a[i] !== b[i]) break;
	return a.slice(0, i);
}
function cook(raw) {
	let out = "";
	let start = 0;
	let i = 0;
	while ((i = raw.indexOf("\\", i)) > -1) {
		out += raw.slice(start, i);
		if (++i === raw.length) return void 0;
		const next = raw[i++];
		switch (next) {
			case "b":
				out += "\b";
				break;
			case "t":
				out += "	";
				break;
			case "n":
				out += "\n";
				break;
			case "v":
				out += "\v";
				break;
			case "f":
				out += "\f";
				break;
			case "r":
				out += "\r";
				break;
			case "\r": if (i < raw.length && raw[i] === "\n") ++i;
			case "\n":
			case "\u2028":
			case "\u2029": break;
			case "0":
				if (isDigit(raw, i)) return void 0;
				out += "\0";
				break;
			case "x": {
				const n = parseHex(raw, i, i + 2);
				if (n === -1) return void 0;
				i += 2;
				out += String.fromCharCode(n);
				break;
			}
			case "u": {
				let n;
				if (i < raw.length && raw[i] === "{") {
					const end = raw.indexOf("}", ++i);
					if (end === -1) return void 0;
					n = parseHex(raw, i, end);
					i = end + 1;
				} else {
					n = parseHex(raw, i, i + 4);
					i += 4;
				}
				if (n === -1 || n > 1114111) return void 0;
				out += String.fromCodePoint(n);
				break;
			}
			default:
				if (isDigit(next, 0)) return void 0;
				out += next;
		}
		start = i;
	}
	return out + raw.slice(start);
}
function isDigit(str, index) {
	const c = str.charCodeAt(index);
	return c >= zero && c <= nine;
}
function parseHex(str, index, end) {
	if (end >= str.length) return -1;
	let n = 0;
	for (; index < end; index++) {
		const c = hexToInt(str.charCodeAt(index));
		if (c === -1) return -1;
		n = n * 16 + c;
	}
	return n;
}
function hexToInt(c) {
	if (c >= zero && c <= nine) return c - zero;
	if (c >= lowerA && c <= lowerF) return c - lowerA + 10;
	if (c >= upperA && c <= upperF) return c - upperA + 10;
	return -1;
}
//#endregion
//#region ../../node_modules/.pnpm/zustand@5.0.14_@types+react@19.2.17_react@19.2.7/node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
	let state;
	const listeners = /* @__PURE__ */ new Set();
	const setState = (partial, replace) => {
		const nextState = typeof partial === "function" ? partial(state) : partial;
		if (!Object.is(nextState, state)) {
			const previousState = state;
			state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
			listeners.forEach((listener) => listener(state, previousState));
		}
	};
	const getState = () => state;
	const getInitialState = () => initialState;
	const subscribe = (listener) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const api = {
		setState,
		getState,
		getInitialState,
		subscribe
	};
	const initialState = state = createState(setState, getState, api);
	return api;
};
var createStore = ((createState) => createState ? createStoreImpl(createState) : createStoreImpl);
//#endregion
//#region src/toolbar/toolbar.ts
function initPenguinBrowserToolbar(penguinLogoUrl) {
	if (window.__penguinBrowserToolbarInstalled) return;
	window.__penguinBrowserToolbarInstalled = true;
	try {
		if (window !== window.top) return;
	} catch {
		return;
	}
	let pinModeActive = false;
	let pinCount = 0;
	let toastTimer = null;
	let overlayEl = null;
	let pinBtn;
	const host = document.createElement("div");
	host.setAttribute("data-penguin-browser-toolbar", "1");
	host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;font-size:0;line-height:0;";
	const shadow = host.attachShadow({ mode: "closed" });
	const styleEl = document.createElement("style");
	styleEl.textContent = `
    *,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      background: #fff;
      border-radius: 10px;
      pointer-events: all;
      user-select: none;
      box-shadow: 0px 0px 0.5px rgba(0,0,0,0.18), 0px 3px 8px rgba(0,0,0,0.1), 0px 1px 3px rgba(0,0,0,0.1);
    }
    .divider {
      width: 1px;
      height: 12px;
      background: rgba(0, 0, 0, 0.08);
      margin: 0 1px;
      flex-shrink: 0;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: #000;
      cursor: pointer;
      transition: background 0.1s;
      padding: 0;
      flex-shrink: 0;
      outline: none;
    }
    .btn:hover {
      background: rgba(0, 0, 0, 0.04);
    }
    .btn.active {
      background: #0d99ff;
      color: #fff;
    }
    .btn.active:hover {
      background: #0d99ff;
      filter: brightness(1.05);
    }
    .penguin-logo {
      width: 18px;
      height: 18px;
      display: block;
    }
    .toast {
      position: fixed;
      background: #0f172a;
      border-radius: 8px;
      padding: 9px 18px;
      color: rgba(255, 255, 255, 0.85);
      font-size: 11px;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      pointer-events: none;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
      white-space: nowrap;
      z-index: 1;
      --toast-transform: translateX(-50%);
      animation: toast-in 0.15s ease;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: var(--toast-transform) translateY(4px); }
      to   { opacity: 1; transform: var(--toast-transform); }
    }
  `;
	const toolbarEl = document.createElement("div");
	toolbarEl.className = "toolbar";
	toolbarEl.setAttribute("role", "toolbar");
	toolbarEl.setAttribute("aria-label", "Penguin Browser tools");
	shadow.appendChild(styleEl);
	shadow.appendChild(toolbarEl);
	function showToast(msg, anchorRect) {
		shadow.querySelectorAll(".toast").forEach((el) => {
			el.remove();
		});
		if (toastTimer !== null) clearTimeout(toastTimer);
		const toastEl = document.createElement("div");
		toastEl.className = "toast";
		toastEl.textContent = msg;
		if (anchorRect) {
			const GAP = 8;
			const centerX = anchorRect.left + anchorRect.width / 2;
			const belowY = anchorRect.bottom + GAP;
			const fitsBelow = belowY + 36 < window.innerHeight;
			const top = fitsBelow ? belowY : anchorRect.top - GAP;
			const transformOrigin = fitsBelow ? "top center" : "bottom center";
			toastEl.style.left = Math.max(8, Math.min(centerX, window.innerWidth - 8)) + "px";
			toastEl.style.top = top + "px";
			const baseTransform = fitsBelow ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)";
			toastEl.style.setProperty("--toast-transform", baseTransform);
			toastEl.style.transform = baseTransform;
			toastEl.style.transformOrigin = transformOrigin;
		} else {
			toastEl.style.bottom = "20px";
			toastEl.style.left = "50%";
			toastEl.style.transform = "translateX(-50%)";
		}
		shadow.appendChild(toastEl);
		toastTimer = window.setTimeout(() => {
			toastEl.remove();
		}, 1900);
	}
	function getOverlay() {
		if (!overlayEl) {
			const EDGE = "color-mix(in oklch, oklch(0.62 0.18 255) 80%, transparent)";
			const FILL = "color-mix(in oklch, oklch(0.62 0.18 255) 8%, transparent)";
			const container = document.createElement("div");
			container.setAttribute("data-penguin-browser-overlay", "1");
			container.style.cssText = [
				"position:fixed",
				"pointer-events:none",
				"z-index:2147483646",
				`background:${FILL}`,
				"display:none"
			].join(";");
			const edgeTop = document.createElement("div");
			edgeTop.style.cssText = `position:absolute;top:0;left:0;width:100%;height:1px;background:${EDGE};`;
			const edgeRight = document.createElement("div");
			edgeRight.style.cssText = `position:absolute;top:0;right:0;width:1px;height:100%;background:${EDGE};`;
			const edgeBottom = document.createElement("div");
			edgeBottom.style.cssText = `position:absolute;bottom:0;left:0;width:100%;height:1px;background:${EDGE};`;
			const edgeLeft = document.createElement("div");
			edgeLeft.style.cssText = `position:absolute;top:0;left:0;width:1px;height:100%;background:${EDGE};`;
			container.appendChild(edgeTop);
			container.appendChild(edgeRight);
			container.appendChild(edgeBottom);
			container.appendChild(edgeLeft);
			document.documentElement.appendChild(container);
			overlayEl = container;
		}
		return overlayEl;
	}
	function positionOverlay(target) {
		const rect = target.getBoundingClientRect();
		if (!rect.width && !rect.height) return;
		const overlay = getOverlay();
		overlay.style.display = "block";
		overlay.style.top = rect.top + "px";
		overlay.style.left = rect.left + "px";
		overlay.style.width = rect.width + "px";
		overlay.style.height = rect.height + "px";
	}
	function hideOverlay() {
		if (overlayEl) overlayEl.style.display = "none";
	}
	function removeOverlay() {
		if (overlayEl) {
			overlayEl.remove();
			overlayEl = null;
		}
	}
	function getTargetAt(x, y) {
		return document.elementsFromPoint(x, y).find((el) => !el.hasAttribute("data-penguin-browser-overlay") && !el.hasAttribute("data-penguin-browser-toolbar") && el !== document.documentElement && el !== document.body) ?? null;
	}
	function isOverToolbar(e) {
		return e.composedPath().some((node) => node === host);
	}
	function flashElement(el) {
		const s = el.style;
		if (!s) return;
		const prevOutline = s.outline;
		const prevOffset = s.outlineOffset;
		s.outline = "1px solid #22c55e";
		s.outlineOffset = "2px";
		window.setTimeout(() => {
			s.outline = prevOutline;
			s.outlineOffset = prevOffset;
		}, 350);
	}
	function copyText(text) {
		navigator.clipboard.writeText(text).catch(() => {
			try {
				const ta = document.createElement("textarea");
				ta.value = text;
				ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
				document.body.appendChild(ta);
				ta.focus();
				ta.select();
				document.execCommand("copy");
				ta.remove();
			} catch {}
		});
	}
	function allocatePinName() {
		const shared = window.__penguinBrowserPinCount;
		if (typeof shared === "number" && shared > pinCount) pinCount = shared;
		pinCount++;
		window.__penguinBrowserPinCount = pinCount;
		return `penguinBrowserPinnedElem${pinCount}`;
	}
	function onMouseMove(e) {
		if (isOverToolbar(e)) {
			hideOverlay();
			return;
		}
		const target = getTargetAt(e.clientX, e.clientY);
		if (target) positionOverlay(target);
		else hideOverlay();
	}
	function buildInspectionCode(n, url) {
		return `inspectPinnedElement(${JSON.stringify(url).replace(/'/g, "\\u0027")},"globalThis.penguinBrowserPinnedElem${n}")`;
	}
	function onClick(e) {
		if (isOverToolbar(e)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		const target = getTargetAt(e.clientX, e.clientY);
		if (!target) return;
		const name = allocatePinName();
		const n = pinCount;
		window[name] = target;
		flashElement(target);
		const url = location.href;
		copyText("penguin-browser -e '" + buildInspectionCode(n, url) + "'");
		showToast("Copied penguin-browser element reference, use it in your agent prompt", target.getBoundingClientRect());
		setPinMode(false);
	}
	function onKeyDown(e) {
		if (e.key === "Escape") setPinMode(false);
	}
	let previousDocumentCursor;
	function setPinMode(on) {
		pinModeActive = on;
		pinBtn.classList.toggle("active", on);
		if (on) {
			if (previousDocumentCursor === void 0) previousDocumentCursor = document.documentElement.style.cursor;
			document.documentElement.style.cursor = "crosshair";
			getOverlay();
			document.addEventListener("mousemove", onMouseMove, {
				capture: true,
				passive: true
			});
			document.addEventListener("click", onClick, true);
			document.addEventListener("keydown", onKeyDown, true);
		} else {
			if (previousDocumentCursor !== void 0) {
				document.documentElement.style.cursor = previousDocumentCursor;
				previousDocumentCursor = void 0;
			}
			hideOverlay();
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("keydown", onKeyDown, true);
		}
	}
	const PENGUIN_LOGO = `<img class="penguin-logo" src="${penguinLogoUrl}" alt="Penguin Browser" />`;
	const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
	pinBtn = document.createElement("button");
	pinBtn.className = "btn";
	pinBtn.setAttribute("aria-label", "Pin element — click any element to copy inspection code for a penguin-browser -e call");
	pinBtn.setAttribute("title", "Pin element (click to copy inspection code)");
	pinBtn.innerHTML = PENGUIN_LOGO;
	pinBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setPinMode(!pinModeActive);
	});
	const dividerEl = document.createElement("div");
	dividerEl.className = "divider";
	dividerEl.setAttribute("aria-hidden", "true");
	const closeBtn = document.createElement("button");
	closeBtn.className = "btn";
	closeBtn.setAttribute("aria-label", "Close Penguin Browser toolbar");
	closeBtn.setAttribute("title", "Close toolbar");
	closeBtn.innerHTML = CLOSE_SVG;
	closeBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		setPinMode(false);
		host.style.display = "none";
	});
	toolbarEl.appendChild(pinBtn);
	toolbarEl.appendChild(dividerEl);
	toolbarEl.appendChild(closeBtn);
	document.documentElement.appendChild(host);
	window.__penguinBrowserToolbarDestroy = function() {
		setPinMode(false);
		removeOverlay();
		host.remove();
		delete window.__penguinBrowserToolbarInstalled;
		delete window.__penguinBrowserToolbarDestroy;
		delete window.__penguinBrowserPinCount;
	};
}
//#endregion
//#region ../../node_modules/.pnpm/penguin-browser@file+packages+browser-cli_@types+react@19.2.17_bufferutil@4.1.0_react-d_615f41587fd7a093d31af31c1ebeaff4/node_modules/penguin-browser/src/ghost-browser.ts
/**
* Handles ghost-browser commands in the extension.
* Calls the appropriate chrome.* API and returns the result.
*
* @param params - Command parameters (namespace, method, args)
* @param chromeApi - The chrome object (passed to avoid global dependency)
* @returns Result object with success/error status
*/
async function handleGhostBrowserCommand(params, chromeApi) {
	const { namespace, method, args } = params;
	try {
		const api = chromeApi[namespace];
		if (!api) return {
			success: false,
			error: `chrome.${namespace} not available (not running in Ghost Browser?)`
		};
		const fn = api[method];
		if (typeof fn !== "function") {
			if (method in api) return {
				success: true,
				result: api[method]
			};
			return {
				success: false,
				error: `chrome.${namespace}.${method} is not a function or property`
			};
		}
		return {
			success: true,
			result: await new Promise((resolve, reject) => {
				fn.call(api, ...args, (result) => {
					if (chromeApi.runtime.lastError) reject(new Error(chromeApi.runtime.lastError.message));
					else resolve(result);
				});
			})
		};
	} catch (error) {
		return {
			success: false,
			error: error.message
		};
	}
}
//#endregion
//#region ../browser-cli/dist/ghost-cursor-client.js?raw
var ghost_cursor_client_default = "\"use strict\";\n(() => {\n  // src/assets/cursors/screen-studio/pointer-macos-tahoe-data-url.ts\n  var SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL = \"data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjE4IiBoZWlnaHQ9Ijk1OCIgdmlld0JveD0iMCAwIDYxOCA5NTgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIwX2RfMzg0XzI3KSI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTI3LjA2MiAzNy4wMzMxTDU0MC42OTYgNDUxLjU1NUM1OTIuNjUzIDUwMy42NiA1NTUuNzk0IDU5Mi41NzQgNDgyLjIyNiA1OTIuNTc0TDQyMS44MzEgNTkyLjU2OUw0ODEuODIxIDczNS4wNTRDNDkyLjMzMSA3NjAuMDIxIDQ5Mi40NzkgNzg3LjY1MiA0ODIuMjY1IDgxMi43NjdDNDcyLjAwMiA4MzcuOTMyIDQ1Mi41NjEgODU3LjU3IDQyNy40OTYgODY4LjA4QzQxNC44NjQgODczLjM1OSA0MDEuNjQgODc2LjAyNCAzODguMTIxIDg3Ni4wMjRDMzQ3LjExNyA4NzYuMDI0IDMxMC4zNTggODUxLjYgMjk0LjQ3IDgxMy44MDRMMjMxLjQyIDY2My45MThMMTkwLjM2OCA3MDAuMzM3QzEzNy4wMjkgNzQ3LjUwOCA1MyA3MDkuNjYzIDUzIDYzOC40MTNWNjcuNjc0NEM1MyAyOC45OTAzIDk5LjcyNjggOS42NDgyOCAxMjcuMDYyIDM3LjAzMzFaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTEwMi4zMTYgOTkuNjUyQzEwMi4zMTYgOTMuMTg4MiAxMTAuMTYyIDg5LjkzMTYgMTE0LjcwMSA5NC41MjA0TDUwNC44OTcgNDg1LjU1NUM1MjYuMTY0IDUwNi44NzEgNTExLjA2NSA1NDMuMjM2IDQ4MC45NjcgNTQzLjIzNkwzNDcuNTQ2IDU0My4xNjFMNDM2LjM0MiA3NTQuMTQzQzQ0Ny41NDIgNzgwLjc4OCA0MzUuMDA5IDgxMS40MjkgNDA4LjQxNCA4MjIuNTgxQzM4MS43MiA4MzMuNzgxIDM1MS4xMjggODIxLjI5OCAzMzkuOTc3IDc5NC43MDJMMjUwLjI5MyA1ODEuMzUyTDE1OC41MTcgNjYyLjY0NEMxMzcuOTkxIDY4MC44MDEgMTA2LjMxOSA2NjguMTQ1IDEwMi42NjQgNjQyLjMyM0wxMDIuMzE2IDYzNy4zMzFWOTkuNjUyWiIgZmlsbD0iYmxhY2siLz4KPC9nPgo8ZGVmcz4KPGZpbHRlciBpZD0iZmlsdGVyMF9kXzM4NF8yNyIgeD0iMC4zNCIgeT0iMC43OTkyMTkiIHdpZHRoPSI2MTcuMzIiIGhlaWdodD0iOTU3LjE0NCIgZmlsdGVyVW5pdHM9InVzZXJTcGFjZU9uVXNlIiBjb2xvci1pbnRlcnBvbGF0aW9uLWZpbHRlcnM9InNSR0IiPgo8ZmVGbG9vZCBmbG9vZC1vcGFjaXR5PSIwIiByZXN1bHQ9IkJhY2tncm91bmRJbWFnZUZpeCIvPgo8ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz4KPGZlT2Zmc2V0IGR5PSIyOS4yNiIvPgo8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyNi4zMyIvPgo8ZmVDb21wb3NpdGUgaW4yPSJoYXJkQWxwaGEiIG9wZXJhdG9yPSJvdXQiLz4KPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAuNjUgMCIvPgo8ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluMj0iQmFja2dyb3VuZEltYWdlRml4IiByZXN1bHQ9ImVmZmVjdDFfZHJvcFNoYWRvd18zODRfMjciLz4KPGZlQmxlbmQgbW9kZT0ibm9ybWFsIiBpbj0iU291cmNlR3JhcGhpYyIgaW4yPSJlZmZlY3QxX2Ryb3BTaGFkb3dfMzg0XzI3IiByZXN1bHQ9InNoYXBlIi8+CjwvZmlsdGVyPgo8L2RlZnM+Cjwvc3ZnPg==\";\n\n  // src/ghost-cursor-client.ts\n  var isTopFrame = (() => {\n    try {\n      return window === window.top;\n    } catch {\n      return false;\n    }\n  })();\n  var CURSOR_ID = \"__penguinBrowser_ghost_cursor__\";\n  var SCREENSTUDIO_POINTER_ASPECT_RATIO = 618 / 958;\n  var SCREENSTUDIO_HOTSPOT_X_RATIO = 0.14;\n  var SCREENSTUDIO_HOTSPOT_Y_RATIO = 0.06;\n  var MINIMAL_TRIANGLE_HOTSPOT_X_RATIO = 0.07;\n  var MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO = 0.06;\n  var MOVE_EASING = \"cubic-bezier(0.65, 0, 0.35, 1)\";\n  var PRESS_EASING = \"cubic-bezier(0.23, 1, 0.32, 1)\";\n  var PRESS_DURATION_MS = 140;\n  var IDLE_HIDE_DELAY_MS = 5e3;\n  var IDLE_FADE_OUT_MS = 600;\n  var DEFAULT_OPTIONS = {\n    style: \"minimal\",\n    color: \"#111827\",\n    size: 22,\n    zIndex: 2147483647,\n    easing: MOVE_EASING,\n    // Slow enough to track with the eye. Override per-call via ghostCursor.show().\n    minDurationMs: 220,\n    maxDurationMs: 1500,\n    speedPxPerMs: 1.2\n  };\n  var runtime = {\n    outerElement: null,\n    innerElement: null,\n    options: DEFAULT_OPTIONS,\n    x: 0,\n    y: 0,\n    scale: 1,\n    hasPosition: false,\n    enabled: false,\n    idleHidden: false\n  };\n  var idleHideTimer = null;\n  function clamp(options) {\n    const { value, min, max } = options;\n    return Math.min(max, Math.max(min, value));\n  }\n  function mergeOptions(options) {\n    if (!options) {\n      return DEFAULT_OPTIONS;\n    }\n    return {\n      style: options.style ?? DEFAULT_OPTIONS.style,\n      color: options.color ?? DEFAULT_OPTIONS.color,\n      size: options.size ?? DEFAULT_OPTIONS.size,\n      zIndex: options.zIndex ?? DEFAULT_OPTIONS.zIndex,\n      easing: options.easing ?? DEFAULT_OPTIONS.easing,\n      minDurationMs: options.minDurationMs ?? DEFAULT_OPTIONS.minDurationMs,\n      maxDurationMs: options.maxDurationMs ?? DEFAULT_OPTIONS.maxDurationMs,\n      speedPxPerMs: options.speedPxPerMs ?? DEFAULT_OPTIONS.speedPxPerMs\n    };\n  }\n  function getCursorDimensions() {\n    if (runtime.options.style === \"screenstudio\") {\n      const height = runtime.options.size;\n      const width = Math.max(10, Math.round(height * SCREENSTUDIO_POINTER_ASPECT_RATIO));\n      return { width, height };\n    }\n    if (runtime.options.style === \"minimal\") {\n      const size = Math.max(12, runtime.options.size);\n      return { width: size, height: size };\n    }\n    return { width: runtime.options.size, height: runtime.options.size };\n  }\n  function getHotspotOffsetPx() {\n    const dimensions = getCursorDimensions();\n    if (runtime.options.style === \"screenstudio\") {\n      return {\n        x: Math.round(dimensions.width * SCREENSTUDIO_HOTSPOT_X_RATIO),\n        y: Math.round(dimensions.height * SCREENSTUDIO_HOTSPOT_Y_RATIO)\n      };\n    }\n    if (runtime.options.style === \"minimal\") {\n      return {\n        x: Math.round(dimensions.width * MINIMAL_TRIANGLE_HOTSPOT_X_RATIO),\n        y: Math.round(dimensions.height * MINIMAL_TRIANGLE_HOTSPOT_Y_RATIO)\n      };\n    }\n    return {\n      x: Math.round(dimensions.width / 2),\n      y: Math.round(dimensions.height / 2)\n    };\n  }\n  function getBaseOpacity() {\n    if (runtime.options.style === \"screenstudio\") {\n      return \"0.95\";\n    }\n    if (runtime.options.style === \"minimal\") {\n      return \"1\";\n    }\n    return \"0.72\";\n  }\n  function applyTranslate() {\n    if (!runtime.outerElement) {\n      return;\n    }\n    const hotspot = getHotspotOffsetPx();\n    runtime.outerElement.style.transform = `translate3d(${runtime.x - hotspot.x}px, ${runtime.y - hotspot.y}px, 0)`;\n  }\n  function applyScale() {\n    if (!runtime.innerElement) {\n      return;\n    }\n    runtime.innerElement.style.transform = `scale(${runtime.scale})`;\n  }\n  function computeDurationMs(options) {\n    if (!runtime.hasPosition) {\n      return 0;\n    }\n    const dx = options.targetX - runtime.x;\n    const dy = options.targetY - runtime.y;\n    const distance = Math.hypot(dx, dy);\n    const rawDurationMs = distance / runtime.options.speedPxPerMs;\n    return clamp({\n      value: rawDurationMs,\n      min: runtime.options.minDurationMs,\n      max: runtime.options.maxDurationMs\n    });\n  }\n  function createCursorElement() {\n    const outer = document.createElement(\"div\");\n    outer.id = CURSOR_ID;\n    outer.setAttribute(\"aria-hidden\", \"true\");\n    outer.style.position = \"fixed\";\n    outer.style.left = \"0\";\n    outer.style.top = \"0\";\n    outer.style.pointerEvents = \"none\";\n    outer.style.zIndex = `${runtime.options.zIndex}`;\n    outer.style.transitionProperty = \"transform\";\n    outer.style.transitionTimingFunction = runtime.options.easing;\n    outer.style.transitionDuration = \"0ms\";\n    outer.style.willChange = \"transform\";\n    const inner = document.createElement(\"div\");\n    inner.style.transitionProperty = \"transform, opacity\";\n    inner.style.transitionTimingFunction = PRESS_EASING;\n    inner.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n    inner.style.opacity = getBaseOpacity();\n    outer.appendChild(inner);\n    runtime.outerElement = outer;\n    runtime.innerElement = inner;\n    applyRuntimeVisualOptions();\n    return outer;\n  }\n  function ensureCursorElement() {\n    const existing = document.getElementById(CURSOR_ID);\n    if (existing) {\n      runtime.outerElement = existing;\n      runtime.innerElement = existing.firstElementChild || null;\n      return existing;\n    }\n    const outer = createCursorElement();\n    const root = document.documentElement || document.body;\n    root.appendChild(outer);\n    return outer;\n  }\n  function applyRuntimeVisualOptions() {\n    if (!runtime.innerElement) {\n      return;\n    }\n    const dimensions = getCursorDimensions();\n    runtime.innerElement.style.width = `${dimensions.width}px`;\n    runtime.innerElement.style.height = `${dimensions.height}px`;\n    if (runtime.outerElement) {\n      runtime.outerElement.style.zIndex = `${runtime.options.zIndex}`;\n      runtime.outerElement.style.transitionTimingFunction = runtime.options.easing;\n    }\n    const hotspot = getHotspotOffsetPx();\n    runtime.innerElement.style.transformOrigin = `${hotspot.x}px ${hotspot.y}px`;\n    if (runtime.options.style === \"screenstudio\") {\n      runtime.innerElement.style.borderRadius = \"0\";\n      runtime.innerElement.style.border = \"none\";\n      runtime.innerElement.style.backgroundColor = \"transparent\";\n      runtime.innerElement.style.backgroundImage = `url(\"${SCREENSTUDIO_POINTER_MACOS_TAHOE_DATA_URL}\")`;\n      runtime.innerElement.style.backgroundRepeat = \"no-repeat\";\n      runtime.innerElement.style.backgroundPosition = \"left top\";\n      runtime.innerElement.style.backgroundSize = \"contain\";\n      runtime.innerElement.style.backdropFilter = \"none\";\n      runtime.innerElement.style.filter = \"none\";\n      runtime.innerElement.style.boxShadow = \"none\";\n      runtime.innerElement.style.opacity = getBaseOpacity();\n      return;\n    }\n    if (runtime.options.style === \"minimal\") {\n      const triangleSvg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"-1 -1 26 26\"><path fill=\"white\" stroke=\"${runtime.options.color}\" stroke-width=\"1.5\" stroke-linejoin=\"round\" d=\"m23.284 19.124l-6.866-6.895a.4.4 0 0 1-.118-.296a.43.43 0 0 1 .163-.282l4.439-3.077a1.48 1.48 0 0 0 .621-1.48a1.48 1.48 0 0 0-1.036-1.198L1.623.302a1.14 1.14 0 0 0-1.11.282A1.13 1.13 0 0 0 .29 1.649L5.928 20.44a1.48 1.48 0 0 0 1.183 1.035a1.48 1.48 0 0 0 1.48-.621l3.078-4.44a.37.37 0 0 1 .31-.118a.43.43 0 0 1 .296.104l6.91 6.91a1.48 1.48 0 0 0 2.087 0l2.086-2.086a1.48 1.48 0 0 0-.074-2.101\"/></svg>`;\n      const triangleDataUrl = `url(\"data:image/svg+xml,${encodeURIComponent(triangleSvg)}\")`;\n      runtime.innerElement.style.borderRadius = \"0\";\n      runtime.innerElement.style.border = \"none\";\n      runtime.innerElement.style.backgroundColor = \"transparent\";\n      runtime.innerElement.style.backgroundImage = triangleDataUrl;\n      runtime.innerElement.style.backgroundRepeat = \"no-repeat\";\n      runtime.innerElement.style.backgroundSize = \"contain\";\n      runtime.innerElement.style.backgroundPosition = \"left top\";\n      runtime.innerElement.style.backdropFilter = \"none\";\n      runtime.innerElement.style.boxShadow = \"none\";\n      runtime.innerElement.style.filter = \"drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4))\";\n      runtime.innerElement.style.opacity = getBaseOpacity();\n      return;\n    }\n    runtime.innerElement.style.borderRadius = \"999px\";\n    runtime.innerElement.style.border = \"none\";\n    runtime.innerElement.style.backgroundColor = runtime.options.color;\n    runtime.innerElement.style.backgroundImage = \"none\";\n    runtime.innerElement.style.backdropFilter = \"none\";\n    runtime.innerElement.style.filter = \"none\";\n    runtime.innerElement.style.boxShadow = \"0 2px 10px rgba(0, 0, 0, 0.18), inset 0 0 0 2px rgba(255, 255, 255, 0.55)\";\n    runtime.innerElement.style.opacity = getBaseOpacity();\n  }\n  function clearIdleHideTimer() {\n    if (idleHideTimer !== null) {\n      clearTimeout(idleHideTimer);\n      idleHideTimer = null;\n    }\n  }\n  function scheduleIdleHide() {\n    clearIdleHideTimer();\n    idleHideTimer = setTimeout(() => {\n      idleHideTimer = null;\n      if (!runtime.enabled || !runtime.innerElement) {\n        return;\n      }\n      runtime.idleHidden = true;\n      runtime.innerElement.style.transitionDuration = `${IDLE_FADE_OUT_MS}ms`;\n      runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n      runtime.innerElement.style.opacity = \"0\";\n    }, IDLE_HIDE_DELAY_MS);\n  }\n  function wakeFromIdle(options) {\n    runtime.x = options.x;\n    runtime.y = options.y;\n    runtime.hasPosition = true;\n    if (runtime.innerElement) {\n      runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n      runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n      runtime.innerElement.style.opacity = getBaseOpacity();\n    }\n  }\n  function moveCursor(options) {\n    if (!runtime.enabled) {\n      return;\n    }\n    ensureCursorElement();\n    const durationMs = computeDurationMs({ targetX: options.x, targetY: options.y });\n    if (runtime.outerElement) {\n      runtime.outerElement.style.transitionDuration = `${Math.round(durationMs)}ms`;\n      runtime.outerElement.style.transitionTimingFunction = runtime.options.easing;\n    }\n    runtime.x = options.x;\n    runtime.y = options.y;\n    runtime.hasPosition = true;\n    applyTranslate();\n  }\n  function setPressed(options) {\n    if (!runtime.enabled || !runtime.innerElement) {\n      return;\n    }\n    runtime.scale = options.pressed ? runtime.options.style === \"dot\" ? 0.92 : 0.95 : 1;\n    runtime.innerElement.style.transitionDuration = `${PRESS_DURATION_MS}ms`;\n    runtime.innerElement.style.transitionTimingFunction = PRESS_EASING;\n    runtime.innerElement.style.opacity = options.pressed ? \"1\" : getBaseOpacity();\n    applyScale();\n  }\n  function enable(options) {\n    runtime.options = mergeOptions(options);\n    runtime.enabled = true;\n    ensureCursorElement();\n    applyRuntimeVisualOptions();\n    if (!runtime.hasPosition) {\n      runtime.x = Math.round(window.innerWidth / 2);\n      runtime.y = Math.round(window.innerHeight / 2);\n      runtime.scale = 1;\n      runtime.hasPosition = true;\n    }\n    runtime.idleHidden = false;\n    if (runtime.innerElement) {\n      runtime.innerElement.style.opacity = getBaseOpacity();\n    }\n    applyTranslate();\n    applyScale();\n    scheduleIdleHide();\n  }\n  function disable() {\n    runtime.enabled = false;\n    runtime.scale = 1;\n    runtime.hasPosition = false;\n    runtime.idleHidden = false;\n    clearIdleHideTimer();\n    if (runtime.outerElement) {\n      runtime.outerElement.remove();\n      runtime.outerElement = null;\n      runtime.innerElement = null;\n    }\n  }\n  function applyMouseAction(action) {\n    if (!runtime.enabled) {\n      return;\n    }\n    if (runtime.idleHidden) {\n      runtime.idleHidden = false;\n      wakeFromIdle({ x: action.x, y: action.y });\n    }\n    if (action.type === \"move\" || action.type === \"wheel\") {\n      moveCursor({ x: action.x, y: action.y });\n    } else if (action.type === \"down\") {\n      moveCursor({ x: action.x, y: action.y });\n      setPressed({ pressed: true });\n    } else if (action.type === \"up\") {\n      moveCursor({ x: action.x, y: action.y });\n      setPressed({ pressed: false });\n    }\n    scheduleIdleHide();\n  }\n  var api = {\n    enable,\n    disable,\n    applyMouseAction,\n    isEnabled: () => {\n      return runtime.enabled;\n    }\n  };\n  if (isTopFrame) {\n    globalThis.__penguinBrowserGhostCursor = api;\n    try {\n      if (document.readyState === \"loading\") {\n        document.addEventListener(\n          \"DOMContentLoaded\",\n          () => {\n            try {\n              api.enable();\n            } catch {\n            }\n          },\n          { once: true }\n        );\n      } else {\n        api.enable();\n      }\n    } catch {\n    }\n  }\n})();\n";
//#endregion
//#region ../browser-cli/dist/bippy.js?raw
var bippy_default = "\"use strict\";\n(() => {\n  // ../../node_modules/.pnpm/bippy@0.5.43_react@19.2.7/node_modules/bippy/dist/rdt-hook.js\n  var e = `0.5.43`;\n  var t = `bippy-${e}`;\n  var n = Object.defineProperty;\n  var r = Object.prototype.hasOwnProperty;\n  var i = () => {\n  };\n  var a = (e2) => {\n    try {\n      Function.prototype.toString.call(e2).indexOf(`^_^`) > -1 && setTimeout(() => {\n        throw Error(`React is running in production mode, but dead code elimination has not been applied. Read how to correctly configure React for production: https://reactjs.org/link/perf-use-production-build`);\n      });\n    } catch {\n    }\n  };\n  var o = (e2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) => !!(e2 && `getFiberRoots` in e2);\n  var s = false;\n  var c;\n  var l = (e2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) => s ? true : (e2 && typeof e2.inject == `function` && (c = e2.inject.toString()), !!c?.includes(`(injected)`));\n  var u = /* @__PURE__ */ new Set();\n  var d = /* @__PURE__ */ new Set();\n  var f = (e2) => {\n    let r2 = /* @__PURE__ */ new Map(), o3 = 0, s3 = { _instrumentationIsActive: false, _instrumentationSource: t, checkDCE: a, hasUnsupportedRendererAttached: false, inject(e3) {\n      let t2 = ++o3;\n      return r2.set(t2, e3), d.add(e3), s3._instrumentationIsActive || (s3._instrumentationIsActive = true, u.forEach((e4) => e4())), t2;\n    }, on: i, onCommitFiberRoot: i, onCommitFiberUnmount: i, onPostCommitFiberRoot: i, renderers: r2, supportsFiber: true, supportsFlight: true };\n    try {\n      n(globalThis, `__REACT_DEVTOOLS_GLOBAL_HOOK__`, { configurable: true, enumerable: true, get() {\n        return s3;\n      }, set(t3) {\n        if (t3 && typeof t3 == `object`) {\n          let n2 = s3.renderers;\n          s3 = t3, n2.size > 0 && (n2.forEach((e3, n3) => {\n            d.add(e3), t3.renderers.set(n3, e3);\n          }), p(e2));\n        }\n      } });\n      let t2 = window.hasOwnProperty, r3 = false;\n      n(window, `hasOwnProperty`, { configurable: true, value: function(...e3) {\n        try {\n          if (!r3 && e3[0] === `__REACT_DEVTOOLS_GLOBAL_HOOK__`) return globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = void 0, r3 = true, -0;\n        } catch {\n        }\n        return t2.apply(this, e3);\n      }, writable: true });\n    } catch {\n      p(e2);\n    }\n    return s3;\n  };\n  var p = (e2) => {\n    e2 && u.add(e2);\n    try {\n      let n2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;\n      if (!n2) return;\n      if (!n2._instrumentationSource) {\n        n2.checkDCE = a, n2.supportsFiber = true, n2.supportsFlight = true, n2.hasUnsupportedRendererAttached = false, n2._instrumentationSource = t, n2._instrumentationIsActive = false;\n        let e3 = o(n2);\n        if (e3 || (n2.on = i), n2.renderers.size) {\n          n2._instrumentationIsActive = true, u.forEach((e4) => e4());\n          return;\n        }\n        let r2 = n2.inject, c3 = l(n2);\n        c3 && !e3 && (s = true, n2.inject({ scheduleRefresh() {\n        } }) && (n2._instrumentationIsActive = true)), n2.inject = (e4) => {\n          let t2 = r2(e4);\n          return d.add(e4), c3 && n2.renderers.set(t2, e4), n2._instrumentationIsActive = true, u.forEach((e5) => e5()), t2;\n        };\n      }\n      (n2.renderers.size || n2._instrumentationIsActive || l()) && e2?.();\n    } catch {\n    }\n  };\n  var m = () => r.call(globalThis, `__REACT_DEVTOOLS_GLOBAL_HOOK__`);\n  var h = (e2) => m() ? (p(e2), globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) : f(e2);\n  var g = () => !!(typeof window < `u` && (window.document?.createElement || window.navigator?.product === `ReactNative`));\n  var _ = () => {\n    try {\n      g() && h();\n    } catch {\n    }\n  };\n\n  // ../../node_modules/.pnpm/bippy@0.5.43_react@19.2.7/node_modules/bippy/dist/install-hook-only.js\n  _();\n\n  // ../../node_modules/.pnpm/bippy@0.5.43_react@19.2.7/node_modules/bippy/dist/core.js\n  var b = (e2) => {\n    switch (e2.tag) {\n      case 5:\n      case 26:\n      case 27:\n        return true;\n      default:\n        return typeof e2.type == `string`;\n    }\n  };\n  var be = (e2) => {\n    switch (e2.tag) {\n      case 1:\n      case 11:\n      case 0:\n      case 14:\n      case 15:\n        return true;\n      default:\n        return false;\n    }\n  };\n  function A(e2, t2, n2 = false) {\n    if (!e2) return null;\n    let r2 = t2(e2);\n    if (r2 instanceof Promise) return (async () => {\n      if (await r2 === true) return e2;\n      let i4 = n2 ? e2.return : e2.child;\n      for (; i4; ) {\n        let e3 = await M(i4, t2, n2);\n        if (e3) return e3;\n        i4 = n2 ? null : i4.sibling;\n      }\n      return null;\n    })();\n    if (r2 === true) return e2;\n    let i3 = n2 ? e2.return : e2.child;\n    for (; i3; ) {\n      let e3 = j(i3, t2, n2);\n      if (e3) return e3;\n      i3 = n2 ? null : i3.sibling;\n    }\n    return null;\n  }\n  var j = (e2, t2, n2 = false) => {\n    if (!e2) return null;\n    if (t2(e2) === true) return e2;\n    let r2 = n2 ? e2.return : e2.child;\n    for (; r2; ) {\n      let e3 = j(r2, t2, n2);\n      if (e3) return e3;\n      r2 = n2 ? null : r2.sibling;\n    }\n    return null;\n  };\n  var M = async (e2, t2, n2 = false) => {\n    if (!e2) return null;\n    if (await t2(e2) === true) return e2;\n    let r2 = n2 ? e2.return : e2.child;\n    for (; r2; ) {\n      let e3 = await M(r2, t2, n2);\n      if (e3) return e3;\n      r2 = n2 ? null : r2.sibling;\n    }\n    return null;\n  };\n  var N = (e2) => {\n    let t2 = e2;\n    return typeof t2 == `function` ? t2 : typeof t2 == `object` && t2 ? N(t2.type || t2.render) : null;\n  };\n  var Ee = (e2) => {\n    let t2 = e2;\n    if (typeof t2 == `string`) return t2;\n    if (typeof t2 != `function` && !(typeof t2 == `object` && t2)) return null;\n    let n2 = t2.displayName || t2.name || null;\n    if (n2) return n2;\n    let r2 = N(t2);\n    return r2 && (r2.displayName || r2.name) || null;\n  };\n  var Pe = (e2) => {\n    let t2 = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;\n    if (t2?.renderers) for (let n2 of t2.renderers.values()) try {\n      let t3 = n2.findFiberByHostInstance?.(e2);\n      if (t3) return t3;\n    } catch {\n    }\n    if (typeof e2 == `object` && e2) {\n      if (`_reactRootContainer` in e2) return e2._reactRootContainer?._internalRoot?.current?.child;\n      for (let t3 in e2) if (t3.startsWith(`__reactContainer$`) || t3.startsWith(`__reactInternalInstance$`) || t3.startsWith(`__reactFiber`)) return e2[t3] || null;\n    }\n    return null;\n  };\n  var Z = Error();\n\n  // ../../node_modules/.pnpm/bippy@0.5.43_react@19.2.7/node_modules/bippy/dist/source.js\n  var i2 = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/;\n  var a2 = [`rsc://`, `file:///`, `webpack-internal://`, `webpack://`, `node:`, `turbopack://`, `metro://`, `/app-pages-browser/`, `/(app-pages-browser)/`];\n  var o2 = [`<anonymous>`, `eval`, ``];\n  var s2 = /\\.(jsx|tsx|ts|js)$/;\n  var c2 = /(\\.min|bundle|chunk|vendor|vendors|runtime|polyfill|polyfills)\\.(js|mjs|cjs)$|(chunk|bundle|vendor|vendors|runtime|polyfill|polyfills|framework|app|main|index)[-_.][A-Za-z0-9_-]{4,}\\.(js|mjs|cjs)$|[\\da-f]{8,}\\.(js|mjs|cjs)$|[-_.][\\da-f]{20,}\\.(js|mjs|cjs)$|\\/dist\\/|\\/build\\/|\\/.next\\/|\\/out\\/|\\/node_modules\\/|\\.webpack\\.|\\.vite\\.|\\.turbopack\\./i;\n  var l2 = /^\\?[\\w~.-]+(?:=[^&#]*)?(?:&[\\w~.-]+(?:=[^&#]*)?)*$/;\n  var u2 = /\\(at [^)]+\\)$/;\n  var d3 = /(^|@)\\S+:\\d+/;\n  var f3 = /^\\s*at .*(\\S+:\\d+|\\(native\\))/m;\n  var ee2 = /^(eval@)?(\\[native code\\])?$/;\n  var m3 = (e2, t2) => {\n    if (t2?.includeInElement !== false) {\n      let n2 = e2.split(`\n`), r2 = [];\n      for (let e3 of n2) if (/^\\s*at\\s+/.test(e3)) {\n        let t3 = _3(e3, void 0)[0];\n        t3 && r2.push(t3);\n      } else if (/^\\s*in\\s+/.test(e3)) {\n        let t3 = e3.replace(/^\\s*in\\s+/, ``).replace(/\\s*\\(at .*\\)$/, ``);\n        r2.push({ functionName: t3, source: e3 });\n      } else if (e3.match(d3)) {\n        let t3 = v2(e3, void 0)[0];\n        t3 && r2.push(t3);\n      }\n      return g3(r2, t2);\n    }\n    return e2.match(f3) ? _3(e2, t2) : v2(e2, t2);\n  };\n  var h3 = (e2) => {\n    if (!e2.includes(`:`)) return [e2, void 0, void 0];\n    let t2 = e2.startsWith(`(`) && /:\\d+\\)$/.test(e2) ? e2.slice(1, -1) : e2, n2 = /(.+?)(?::(\\d+))?(?::(\\d+))?$/.exec(t2);\n    return n2 ? [n2[1], n2[2] || void 0, n2[3] || void 0] : [t2, void 0, void 0];\n  };\n  var g3 = (e2, t2) => t2 && t2.slice != null ? Array.isArray(t2.slice) ? e2.slice(t2.slice[0], t2.slice[1]) : e2.slice(0, t2.slice) : e2;\n  var _3 = (e2, t2) => g3(e2.split(`\n`).filter((e3) => !!e3.match(f3)), t2).map((e3) => {\n    let t3 = e3;\n    t3.includes(`(eval `) && (t3 = t3.replace(/eval code/g, `eval`).replace(/(\\(eval at [^()]*)|(,.*$)/g, ``));\n    let n2 = t3.replace(/^\\s+/, ``).replace(/\\(eval code/g, `(`).replace(/^.*?\\s+/, ``), r2 = n2.match(/ (\\(.+\\)$)/);\n    n2 = r2 ? n2.replace(r2[0], ``) : n2;\n    let i3 = h3(r2 ? r2[1] : n2);\n    return { functionName: r2 && n2 || void 0, fileName: [`eval`, `<anonymous>`].includes(i3[0]) ? void 0 : i3[0], lineNumber: i3[1] ? +i3[1] : void 0, columnNumber: i3[2] ? +i3[2] : void 0, source: t3 };\n  });\n  var v2 = (e2, t2) => g3(e2.split(`\n`).filter((e3) => !e3.match(ee2)), t2).map((e3) => {\n    let t3 = e3;\n    if (t3.includes(` > eval`) && (t3 = t3.replace(/ line (\\d+)(?: > eval line \\d+)* > eval:\\d+:\\d+/g, `:$1`)), !t3.includes(`@`) && !t3.includes(`:`)) return { functionName: t3 };\n    {\n      let e4 = /(([^\\n\\r\"\\u2028\\u2029]*\".[^\\n\\r\"\\u2028\\u2029]*\"[^\\n\\r@\\u2028\\u2029]*(?:@[^\\n\\r\"\\u2028\\u2029]*\"[^\\n\\r@\\u2028\\u2029]*)*(?:[\\n\\r\\u2028\\u2029][^@]*)?)?[^@]*)@/, n2 = t3.match(e4), r2 = n2 && n2[1] ? n2[1] : void 0, i3 = h3(t3.replace(e4, ``));\n      return { functionName: r2, fileName: i3[0], lineNumber: i3[1] ? +i3[1] : void 0, columnNumber: i3[2] ? +i3[2] : void 0, source: t3 };\n    }\n  });\n  var se2 = 44;\n  var y = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/`;\n  var ce2 = new Uint8Array(64);\n  var le2 = new Uint8Array(128);\n  for (let e2 = 0; e2 < y.length; e2++) {\n    let t2 = y.charCodeAt(e2);\n    ce2[e2] = t2, le2[t2] = e2;\n  }\n  function b2(e2, t2) {\n    let n2 = 0, r2 = 0, i3 = 0;\n    do\n      i3 = le2[e2.next()], n2 |= (i3 & 31) << r2, r2 += 5;\n    while (i3 & 32);\n    let a3 = n2 & 1;\n    return n2 >>>= 1, a3 && (n2 = -2147483648 | -n2), t2 + n2;\n  }\n  function ue2(e2, t2) {\n    return e2.pos >= t2 ? false : e2.peek() !== se2;\n  }\n  var de2 = class {\n    constructor(e2) {\n      this.pos = 0, this.buffer = e2;\n    }\n    next() {\n      return this.buffer.charCodeAt(this.pos++);\n    }\n    peek() {\n      return this.buffer.charCodeAt(this.pos);\n    }\n    indexOf(e2) {\n      let { buffer: t2, pos: n2 } = this, r2 = t2.indexOf(e2, n2);\n      return r2 === -1 ? t2.length : r2;\n    }\n  };\n  function x2(e2) {\n    let { length: t2 } = e2, n2 = new de2(e2), r2 = [], i3 = 0, a3 = 0, o3 = 0, s3 = 0, c3 = 0;\n    do {\n      let e3 = n2.indexOf(`;`), t3 = [], l3 = true, u3 = 0;\n      for (i3 = 0; n2.pos < e3; ) {\n        let r3;\n        i3 = b2(n2, i3), i3 < u3 && (l3 = false), u3 = i3, ue2(n2, e3) ? (a3 = b2(n2, a3), o3 = b2(n2, o3), s3 = b2(n2, s3), ue2(n2, e3) ? (c3 = b2(n2, c3), r3 = [i3, a3, o3, s3, c3]) : r3 = [i3, a3, o3, s3]) : r3 = [i3], t3.push(r3), n2.pos++;\n      }\n      l3 || fe2(t3), r2.push(t3), n2.pos = e3 + 1;\n    } while (n2.pos <= t2);\n    return r2;\n  }\n  function fe2(e2) {\n    e2.sort(pe2);\n  }\n  function pe2(e2, t2) {\n    return e2[0] - t2[0];\n  }\n  var S2 = /^[a-zA-Z][a-zA-Z\\d+\\-.]*:/;\n  var me2 = /^data:application\\/json[^,]+base64,/;\n  var he2 = /(?:\\/\\/[@#][ \\t]+sourceMappingURL=([^\\s'\"]+?)[ \\t]*$)|(?:\\/\\*[@#][ \\t]+sourceMappingURL=([^*]+?)[ \\t]*(?:\\*\\/)[ \\t]*$)/;\n  var C2 = /* @__PURE__ */ new Map();\n  var w2 = /* @__PURE__ */ new Map();\n  var T2 = (e2, t2, n2, r2) => {\n    if (n2 < 0 || n2 >= e2.length) return null;\n    let i3 = e2[n2];\n    if (!i3 || i3.length === 0) return null;\n    let a3 = null;\n    for (let e3 of i3) if (e3[0] <= r2) a3 = e3;\n    else break;\n    if (!a3 || a3.length < 4) return null;\n    let [, o3, s3, c3] = a3;\n    if (o3 === void 0 || s3 === void 0 || c3 === void 0) return null;\n    let l3 = t2[o3];\n    return l3 ? { columnNumber: c3, fileName: l3, lineNumber: s3 + 1 } : null;\n  };\n  var E2 = (e2, t2, n2) => {\n    if (e2.sections) {\n      let r2 = null;\n      for (let i4 of e2.sections) if (t2 > i4.offset.line || t2 === i4.offset.line && n2 >= i4.offset.column) r2 = i4;\n      else break;\n      if (!r2) return null;\n      let i3 = t2 - r2.offset.line, a3 = t2 === r2.offset.line ? n2 - r2.offset.column : n2;\n      return T2(r2.map.mappings, r2.map.sources, i3, a3);\n    }\n    return T2(e2.mappings, e2.sources, t2 - 1, n2);\n  };\n  var ge2 = (e2, t2) => {\n    let n2 = t2.split(`\n`), r2;\n    for (let e3 = n2.length - 1; e3 >= 0 && !r2; e3--) {\n      let t3 = n2[e3].match(he2);\n      t3 && (r2 = t3[1] || t3[2]);\n    }\n    if (!r2) return null;\n    let i3 = S2.test(r2);\n    if (!(me2.test(r2) || i3 || r2.startsWith(`/`))) {\n      let t3 = e2.split(`/`);\n      t3[t3.length - 1] = r2, r2 = t3.join(`/`);\n    }\n    return r2;\n  };\n  var _e2 = (e2) => ({ file: e2.file, mappings: x2(e2.mappings), names: e2.names, sourceRoot: e2.sourceRoot, sources: e2.sources, sourcesContent: e2.sourcesContent, version: 3 });\n  var ve2 = (e2) => {\n    let t2 = e2.sections.map(({ map: e3, offset: t3 }) => ({ map: { ...e3, mappings: x2(e3.mappings) }, offset: t3 })), n2 = /* @__PURE__ */ new Set();\n    for (let e3 of t2) for (let t3 of e3.map.sources) n2.add(t3);\n    return { file: e2.file, mappings: [], names: [], sections: t2, sourceRoot: void 0, sources: Array.from(n2), sourcesContent: void 0, version: 3 };\n  };\n  var D2 = (e2) => {\n    if (!e2) return false;\n    let t2 = e2.trim();\n    if (!t2) return false;\n    let n2 = t2.match(S2);\n    if (!n2) return true;\n    let r2 = n2[0].toLowerCase();\n    return r2 === `http:` || r2 === `https:`;\n  };\n  var ye2 = async (e2, t2 = fetch) => {\n    if (!D2(e2)) return null;\n    let n2 = await t2(e2);\n    if (!n2.ok) return null;\n    let r2 = await n2.text();\n    if (!r2) return null;\n    let i3 = ge2(e2, r2);\n    if (!i3 || !D2(i3)) return null;\n    let a3 = await t2(i3);\n    if (!a3.ok) return null;\n    try {\n      let e3 = await a3.json();\n      return `sections` in e3 ? ve2(e3) : _e2(e3);\n    } catch {\n      return null;\n    }\n  };\n  var O2 = async (e2, t2 = true, n2) => {\n    if (t2 && C2.has(e2)) return C2.get(e2) ?? null;\n    let r2 = t2 ? w2.get(e2) : void 0;\n    if (r2) return (await r2).sourceMap;\n    let i3 = ye2(e2, n2).then((e3) => ({ sourceMap: e3, isTransientFailure: false }), () => ({ sourceMap: null, isTransientFailure: true }));\n    t2 && w2.set(e2, i3);\n    let { sourceMap: a3, isTransientFailure: o3 } = await i3;\n    return t2 && (w2.delete(e2), o3 || C2.set(e2, a3)), a3;\n  };\n  var be2 = async (e2, t2 = true, n2) => await Promise.all(e2.map(async (e3) => {\n    if (!e3.fileName) return e3;\n    let r2 = await O2(e3.fileName, t2, n2);\n    if (!r2 || typeof e3.lineNumber != `number` || typeof e3.columnNumber != `number`) return e3;\n    let i3 = E2(r2, e3.lineNumber, e3.columnNumber);\n    return i3 ? { ...e3, source: i3.fileName && e3.source ? e3.source.replace(e3.fileName, i3.fileName) : e3.source, fileName: i3.fileName, lineNumber: i3.lineNumber, columnNumber: i3.columnNumber, isSymbolicated: true } : e3;\n  }));\n  var xe2 = (e2) => e2._debugStack instanceof Error && typeof e2._debugStack?.stack == `string`;\n  var Se2 = () => {\n    let n2 = h();\n    for (let t2 of [...Array.from(d), ...Array.from(n2.renderers.values())]) {\n      let e2 = t2.currentDispatcherRef;\n      if (e2 && typeof e2 == `object`) return `H` in e2 ? e2.H : e2.current;\n    }\n    return null;\n  };\n  var Ce2 = (t2) => {\n    for (let n2 of d) {\n      let e2 = n2.currentDispatcherRef;\n      e2 && typeof e2 == `object` && (`H` in e2 ? e2.H = t2 : e2.current = t2);\n    }\n  };\n  var k2 = (e2) => `\n    in ${e2}`;\n  var we2 = (e2, t2) => {\n    let n2 = k2(e2);\n    return t2 && (n2 += ` (at ${t2})`), n2;\n  };\n  var A2 = false;\n  var j2 = (e2, t2) => {\n    if (!e2 || A2) return ``;\n    let r2 = Error.prepareStackTrace;\n    Error.prepareStackTrace = void 0, A2 = true;\n    let i3 = Se2();\n    Ce2(null);\n    let a3 = console.error, o3 = console.warn;\n    console.error = () => {\n    }, console.warn = () => {\n    };\n    try {\n      let r3 = { DetermineComponentFrameRoot() {\n        let n2;\n        try {\n          if (t2) {\n            let t3 = function() {\n              throw Error();\n            };\n            if (Object.defineProperty(t3.prototype, `props`, { set: function() {\n              throw Error();\n            } }), typeof Reflect == `object` && Reflect.construct) {\n              try {\n                Reflect.construct(t3, []);\n              } catch (e3) {\n                n2 = e3;\n              }\n              Reflect.construct(e2, [], t3);\n            } else {\n              try {\n                t3.call();\n              } catch (e3) {\n                n2 = e3;\n              }\n              e2.call(t3.prototype);\n            }\n          } else {\n            try {\n              throw Error();\n            } catch (e3) {\n              n2 = e3;\n            }\n            let t3 = e2();\n            t3 && typeof t3.catch == `function` && t3.catch(() => {\n            });\n          }\n        } catch (e3) {\n          if (e3 instanceof Error && n2 instanceof Error && typeof e3.stack == `string`) return [e3.stack, n2.stack];\n        }\n        return [null, null];\n      } };\n      r3.DetermineComponentFrameRoot.displayName = `DetermineComponentFrameRoot`, Object.getOwnPropertyDescriptor(r3.DetermineComponentFrameRoot, `name`)?.configurable && Object.defineProperty(r3.DetermineComponentFrameRoot, `name`, { value: `DetermineComponentFrameRoot` });\n      let [i4, a4] = r3.DetermineComponentFrameRoot();\n      if (i4 && a4) {\n        let t3 = i4.split(`\n`), r4 = a4.split(`\n`), o4 = 0, s4 = 0;\n        for (; o4 < t3.length && !t3[o4].includes(`DetermineComponentFrameRoot`); ) o4++;\n        for (; s4 < r4.length && !r4[s4].includes(`DetermineComponentFrameRoot`); ) s4++;\n        if (o4 === t3.length || s4 === r4.length) for (o4 = t3.length - 1, s4 = r4.length - 1; o4 >= 1 && s4 >= 0 && t3[o4] !== r4[s4]; ) s4--;\n        for (; o4 >= 1 && s4 >= 0; o4--, s4--) if (t3[o4] !== r4[s4]) {\n          if (o4 !== 1 || s4 !== 1) do\n            if (o4--, s4--, s4 < 0 || t3[o4] !== r4[s4]) {\n              let r5 = `\n${t3[o4].replace(` at new `, ` at `)}`, i5 = Ee(e2);\n              return i5 && r5.includes(`<anonymous>`) && (r5 = r5.replace(`<anonymous>`, i5)), r5;\n            }\n          while (o4 >= 1 && s4 >= 0);\n          break;\n        }\n      }\n    } finally {\n      A2 = false, Error.prepareStackTrace = r2, Ce2(i3), console.error = a3, console.warn = o3;\n    }\n    let s3 = e2 ? Ee(e2) : ``;\n    return s3 ? k2(s3) : ``;\n  };\n  var M2 = (e2, t2) => {\n    let n2 = e2.tag, r2 = ``;\n    switch (n2) {\n      case 28:\n        r2 = k2(`Activity`);\n        break;\n      case 1:\n        r2 = j2(e2.type, true);\n        break;\n      case 11:\n        r2 = j2(e2.type.render, false);\n        break;\n      case 0:\n      case 15:\n        r2 = j2(e2.type, false);\n        break;\n      case 5:\n      case 26:\n      case 27:\n        r2 = k2(e2.type);\n        break;\n      case 16:\n        r2 = k2(`Lazy`);\n        break;\n      case 13:\n        r2 = e2.child !== t2 && t2 !== null ? k2(`Suspense Fallback`) : k2(`Suspense`);\n        break;\n      case 19:\n        r2 = k2(`SuspenseList`);\n        break;\n      case 30:\n        r2 = k2(`ViewTransition`);\n        break;\n      default:\n        return ``;\n    }\n    return r2;\n  };\n  var N2 = (e2) => {\n    try {\n      let t2 = ``, n2 = e2, r2 = null;\n      do {\n        t2 += M2(n2, r2);\n        let e3 = n2._debugInfo;\n        if (e3 && Array.isArray(e3)) for (let n3 = e3.length - 1; n3 >= 0; n3--) {\n          let r3 = e3[n3];\n          typeof r3.name == `string` && (t2 += we2(r3.name, r3.env));\n        }\n        r2 = n2, n2 = n2.return;\n      } while (n2);\n      return t2;\n    } catch (e3) {\n      return e3 instanceof Error ? `\nError generating stack: ${e3.message}\n${e3.stack}` : ``;\n    }\n  };\n  var P2 = (e2) => {\n    let t2 = Error.prepareStackTrace;\n    Error.prepareStackTrace = void 0;\n    let n2 = e2;\n    if (!n2) return ``;\n    Error.prepareStackTrace = t2, n2.startsWith(`Error: react-stack-top-frame\n`) && (n2 = n2.slice(29));\n    let r2 = n2.indexOf(`\n`);\n    if (r2 !== -1 && (n2 = n2.slice(r2 + 1)), r2 = Math.max(n2.indexOf(`react_stack_bottom_frame`), n2.indexOf(`react-stack-bottom-frame`)), r2 !== -1 && (r2 = n2.lastIndexOf(`\n`, r2)), r2 !== -1) n2 = n2.slice(0, r2);\n    else return ``;\n    return n2;\n  };\n  var Te2 = (e2) => !!(e2.functionName && e2.fileName && (e2.fileName.startsWith(`rsc://`) || e2.fileName.startsWith(`about://React/`)));\n  var Ee2 = (e2, t2) => e2.fileName === t2.fileName && e2.lineNumber === t2.lineNumber && e2.columnNumber === t2.columnNumber;\n  var De2 = (e2) => {\n    let t2 = /* @__PURE__ */ new Map();\n    for (let n2 of e2) for (let e3 of n2.stackFrames) {\n      if (!Te2(e3)) continue;\n      let n3 = e3.functionName, r2 = t2.get(n3) ?? [];\n      r2.some((t3) => Ee2(t3, e3)) || (r2.push(e3), t2.set(n3, r2));\n    }\n    return t2;\n  };\n  var Oe2 = (e2, t2, n2) => {\n    if (!e2.functionName) return { ...e2, isServer: true };\n    let r2 = t2.get(e2.functionName);\n    if (!r2 || r2.length === 0) return { ...e2, isServer: true };\n    let i3 = n2.get(e2.functionName) ?? 0, a3 = r2[i3 % r2.length];\n    return n2.set(e2.functionName, i3 + 1), { ...e2, isServer: true, fileName: a3.fileName, lineNumber: a3.lineNumber, columnNumber: a3.columnNumber, source: e2.source?.replace(`(at Server)`, `(${a3.fileName}:${a3.lineNumber}:${a3.columnNumber})`) };\n  };\n  var ke = (e2) => {\n    let t2 = [];\n    return A(e2, (e3) => {\n      if (!xe2(e3)) return;\n      let r2 = typeof e3.type == `string` ? e3.type : Ee(e3.type) || `<anonymous>`;\n      t2.push({ componentName: r2, stackFrames: m3(P2(e3._debugStack?.stack)) });\n    }, true), t2;\n  };\n  var F = async (e2, t2 = true, n2) => {\n    let r2 = ke(e2), i3 = m3(N2(e2)), a3 = De2(r2), o3 = /* @__PURE__ */ new Map();\n    return be2(i3.map((e3) => (e3.source?.includes(`(at Server)`) ?? false) || e3.source != null && u2.test(e3.source) ? Oe2(e3, a3, o3) : e3).filter((e3, t3, n3) => {\n      if (t3 === 0) return true;\n      let r3 = n3[t3 - 1];\n      return e3.functionName !== r3.functionName;\n    }), t2, n2);\n  };\n  var I2 = (e2) => {\n    let t2 = e2._debugSource;\n    return t2 ? typeof t2 == `object` && !!t2 && `fileName` in t2 && typeof t2.fileName == `string` && `lineNumber` in t2 && typeof t2.lineNumber == `number` : false;\n  };\n  var Ae2 = async (e2, t2 = true, n2) => {\n    if (I2(e2)) return e2._debugSource || null;\n    let r2 = await F(e2, t2, n2);\n    for (let e3 of r2) if (e3.fileName) return { fileName: e3.fileName, lineNumber: e3.lineNumber, columnNumber: e3.columnNumber, functionName: e3.functionName };\n    return null;\n  };\n  var L2 = (e2) => e2.split(`/`).filter(Boolean).length;\n  var je2 = (e2) => e2.split(`/`).filter(Boolean)[0] ?? null;\n  var Me2 = (e2) => {\n    let t2 = e2.indexOf(`/`, 1);\n    if (t2 === -1 || L2(e2.slice(0, t2)) !== 1) return e2;\n    let n2 = e2.slice(t2);\n    if (!s2.test(n2) || L2(n2) < 2) return e2;\n    let r2 = je2(n2);\n    return !r2 || r2.startsWith(`@`) || r2.length > 4 ? e2 : n2;\n  };\n  var R2 = (e2) => {\n    if (!e2 || o2.some((t3) => t3 === e2)) return ``;\n    let t2 = e2, n2 = t2.startsWith(`http://`) || t2.startsWith(`https://`);\n    if (n2) try {\n      t2 = new URL(t2).pathname;\n    } catch {\n    }\n    if (n2 && (t2 = Me2(t2)), t2.startsWith(`about://React/`)) {\n      let e3 = t2.slice(14), n3 = e3.indexOf(`/`), r3 = e3.indexOf(`:`);\n      t2 = n3 !== -1 && (r3 === -1 || n3 < r3) ? e3.slice(n3 + 1) : e3;\n    }\n    let r2 = true;\n    for (; r2; ) {\n      r2 = false;\n      for (let e3 of a2) if (t2.startsWith(e3)) {\n        t2 = t2.slice(e3.length), e3 === `file:///` && (t2 = `/${t2.replace(/^\\/+/, ``)}`), r2 = true;\n        break;\n      }\n    }\n    if (i2.test(t2)) {\n      let e3 = t2.match(i2);\n      e3 && (t2 = t2.slice(e3[0].length));\n    }\n    if (t2.startsWith(`//`)) {\n      let e3 = t2.indexOf(`/`, 2);\n      t2 = e3 === -1 ? `` : t2.slice(e3);\n    }\n    let s3 = t2.indexOf(`?`);\n    if (s3 !== -1) {\n      let e3 = t2.slice(s3);\n      l2.test(e3) && (t2 = t2.slice(0, s3));\n    }\n    return t2;\n  };\n  var Ne2 = (e2) => {\n    let t2 = R2(e2);\n    return !(!t2 || !s2.test(t2) || c2.test(t2));\n  };\n  var z2 = /* @__PURE__ */ Symbol.for(`react.context`);\n  var Ie2 = /* @__PURE__ */ Symbol.for(`react.memo_cache_sentinel`);\n  var B2 = [];\n  var H2 = null;\n  var U = null;\n  var W = null;\n  var G = 0;\n  var K = null;\n  var q2 = Error(\"Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render.\");\n  var Y = () => {\n    let e2 = U;\n    return e2 !== null && (U = e2.next), e2;\n  };\n  var X2 = (e2) => {\n    if (H2 === null) return e2._currentValue;\n    if (W === null) throw Error(`Context reads do not line up with context dependencies.`);\n    if (Object.prototype.hasOwnProperty.call(W, `memoizedValue`)) {\n      let e3 = W.memoizedValue;\n      return W = W.next, e3;\n    }\n    return e2._currentValue;\n  };\n  var Z2 = (e2, t2, n2, r2 = null) => {\n    B2.push({ displayName: r2, primitive: e2, stackError: Error(), value: t2, dispatcherHookName: n2 });\n  };\n  var Be = (e2) => {\n    if (typeof e2 == `object` && e2) {\n      let t2 = e2;\n      if (typeof t2.then == `function`) {\n        let e3 = K !== null && G < K.length ? K[G++] : t2;\n        switch (e3.status) {\n          case `fulfilled`:\n            return Z2(`Promise`, e3.value, `Use`), e3.value;\n          case `rejected`:\n            throw e3.reason;\n        }\n        throw Z2(`Unresolved`, e3, `Use`), q2;\n      }\n      if (t2.$$typeof === z2 && `_currentValue` in t2) {\n        let e3 = t2, n2 = X2(e3);\n        return Z2(`Context (use)`, n2, `Use`, e3.displayName || `Context`), n2;\n      }\n    }\n    throw Error(`An unsupported type was passed to use(): ` + String(e2));\n  };\n  var Ve = (e2) => {\n    let t2 = X2(e2);\n    return Z2(`Context`, t2, `Context`, e2.displayName || null), t2;\n  };\n  var He = (e2) => {\n    let t2 = Y(), n2 = t2 === null ? typeof e2 == `function` ? e2() : e2 : t2.memoizedState;\n    return Z2(`State`, n2, `State`), [n2, () => {\n    }];\n  };\n  var Ue = (e2, t2, n2) => {\n    let r2 = Y(), i3 = r2 === null ? n2 === void 0 ? t2 : n2(t2) : r2.memoizedState;\n    return Z2(`Reducer`, i3, `Reducer`), [i3, () => {\n    }];\n  };\n  var We = (e2) => {\n    let t2 = Y(), n2 = t2 === null ? { current: e2 } : t2.memoizedState;\n    return Z2(`Ref`, n2.current, `Ref`), n2;\n  };\n  var Ge = () => {\n    let e2 = Y();\n    return Z2(`CacheRefresh`, e2 === null ? () => {\n    } : e2.memoizedState, `CacheRefresh`), () => {\n    };\n  };\n  var Ke = (e2) => {\n    Y(), Z2(`LayoutEffect`, e2, `LayoutEffect`);\n  };\n  var qe = (e2) => {\n    Y(), Z2(`InsertionEffect`, e2, `InsertionEffect`);\n  };\n  var Je = (e2) => {\n    Y(), Z2(`Effect`, e2, `Effect`);\n  };\n  var Ye = (e2) => {\n    Y();\n    let t2;\n    typeof e2 == `object` && e2 && `current` in e2 && (t2 = e2.current), Z2(`ImperativeHandle`, t2, `ImperativeHandle`);\n  };\n  var Xe = (e2, t2) => {\n    Z2(`DebugValue`, typeof t2 == `function` ? t2(e2) : e2, `DebugValue`);\n  };\n  var Ze = (e2) => {\n    let t2 = Y();\n    return Z2(`Callback`, t2 === null ? e2 : t2.memoizedState[0], `Callback`), e2;\n  };\n  var Qe = (e2) => {\n    let t2 = Y(), n2 = t2 === null ? e2() : t2.memoizedState[0];\n    return Z2(`Memo`, n2, `Memo`), n2;\n  };\n  var $e = (e2, t2) => {\n    let n2 = Y();\n    Y();\n    let r2 = n2 === null ? t2() : n2.memoizedState;\n    return Z2(`SyncExternalStore`, r2, `SyncExternalStore`), r2;\n  };\n  var et = () => {\n    let e2 = Y();\n    Y();\n    let t2 = e2 === null ? false : e2.memoizedState;\n    return Z2(`Transition`, t2, `Transition`), [t2, () => {\n    }];\n  };\n  var tt = (e2) => {\n    let t2 = Y(), n2 = t2 === null ? e2 : t2.memoizedState;\n    return Z2(`DeferredValue`, n2, `DeferredValue`), n2;\n  };\n  var nt = () => {\n    let e2 = Y(), t2 = e2 === null ? `` : e2.memoizedState;\n    return Z2(`Id`, t2, `Id`), t2;\n  };\n  var rt = (e2) => {\n    let t2 = H2;\n    if (t2 == null) return [];\n    let n2 = t2.updateQueue?.memoCache;\n    if (n2 == null) return [];\n    let r2 = n2.data[n2.index];\n    return r2 === void 0 && (r2 = n2.data[n2.index] = Array.from({ length: e2 }, () => Ie2)), n2.index++, r2;\n  };\n  var it = (e2) => {\n    let t2 = Y(), n2 = t2 === null ? e2 : t2.memoizedState;\n    return Z2(`Optimistic`, n2, `Optimistic`), [n2, () => {\n    }];\n  };\n  var at = (e2, t2) => {\n    let n2, r2 = null;\n    if (e2 !== null) {\n      let t3 = e2.memoizedState;\n      if (typeof t3 == `object` && t3 && `then` in t3 && typeof t3.then == `function`) {\n        let e3 = t3;\n        switch (e3.status) {\n          case `fulfilled`:\n            n2 = e3.value;\n            break;\n          case `rejected`:\n            r2 = e3.reason;\n            break;\n          default:\n            r2 = q2, n2 = e3;\n        }\n      } else n2 = t3;\n    } else n2 = t2;\n    return { value: n2, error: r2 };\n  };\n  var ot = (e2) => (t2, n2) => {\n    let r2 = Y();\n    Y(), Y();\n    let i3 = Error(), { value: a3, error: o3 } = at(r2, n2);\n    if (B2.push({ displayName: null, primitive: e2, stackError: i3, value: a3, dispatcherHookName: e2 }), o3 !== null) throw o3;\n    return [a3, () => {\n    }, false];\n  };\n  var st = ot(`ActionState`);\n  var Q2 = { readContext: X2, use: Be, useCallback: Ze, useContext: Ve, useEffect: Je, useImperativeHandle: Ye, useLayoutEffect: Ke, useInsertionEffect: qe, useMemo: Qe, useReducer: Ue, useRef: We, useState: He, useDebugValue: Xe, useDeferredValue: tt, useTransition: et, useSyncExternalStore: $e, useId: nt, useHostTransitionStatus: () => {\n    let e2 = X2({ _currentValue: null });\n    return Z2(`HostTransitionStatus`, e2, `HostTransitionStatus`), e2;\n  }, useFormState: ot(`FormState`), useActionState: st, useOptimistic: it, useMemoCache: rt, useCacheRefresh: Ge, useEffectEvent: (e2) => (Y(), Z2(`EffectEvent`, e2, `EffectEvent`), e2) };\n  var ct = typeof Proxy > `u` ? Q2 : new Proxy(Q2, { get(e2, t2) {\n    if (Object.prototype.hasOwnProperty.call(e2, t2)) return e2[t2];\n    let n2 = Error(`Missing method in Dispatcher: ` + t2);\n    throw n2.name = `ReactDebugToolsUnsupportedHookError`, n2;\n  } });\n\n  // dist/_bippy-entry-3782371-1786536865746.js\n  globalThis.__bippy = {\n    getFiberFromHostInstance: Pe,\n    getDisplayName: Ee,\n    traverseFiber: A,\n    isCompositeFiber: be,\n    isHostFiber: b,\n    getSource: Ae2,\n    getOwnerStack: F,\n    normalizeFileName: R2,\n    isSourceFile: Ne2\n  };\n})();\n/*! Bundled license information:\n\nbippy/dist/rdt-hook.js:\nbippy/dist/install-hook-only.js:\nbippy/dist/core.js:\nbippy/dist/index.js:\nbippy/dist/source.js:\n  (**\n   * @license bippy\n   *\n   * Copyright (c) Aiden Bai\n   *\n   * This source code is licensed under the MIT license found in the\n   * LICENSE file in the root directory of this source tree.\n   *)\n*/\n";
//#endregion
//#region src/recording.ts
var activeRecordings = /* @__PURE__ */ new Map();
var offscreenDocumentCreating = null;
/**
* Get the active recordings map (for cleanup on tab disconnect).
*/
function getActiveRecordings() {
	return activeRecordings;
}
async function ensureOffscreenDocument() {
	if ((await chrome.runtime.getContexts({
		contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		documentUrls: [chrome.runtime.getURL("src/offscreen.html")]
	})).length > 0) return;
	if (offscreenDocumentCreating) return offscreenDocumentCreating;
	offscreenDocumentCreating = chrome.offscreen.createDocument({
		url: "src/offscreen.html",
		reasons: [chrome.offscreen.Reason.USER_MEDIA],
		justification: "Screen recording via chrome.tabCapture"
	});
	try {
		await offscreenDocumentCreating;
	} finally {
		offscreenDocumentCreating = null;
	}
}
function resolveTabIdFromSessionId(sessionId) {
	if (!sessionId) {
		for (const [tabId, tab] of store.getState().tabs) if (tab.state === "connected") return tabId;
		return;
	}
	return getTabBySessionId(sessionId)?.tabId;
}
function updateTabRecordingState(tabId, isRecording) {
	store.setState((state) => {
		const newTabs = new Map(state.tabs);
		const existing = newTabs.get(tabId);
		if (existing) newTabs.set(tabId, {
			...existing,
			isRecording
		});
		return { tabs: newTabs };
	});
}
async function handleStartRecording(params) {
	const tabId = resolveTabIdFromSessionId(params.sessionId);
	if (!tabId) return {
		success: false,
		error: "No connected tab found for recording. Click the Penguin Browser extension icon on the tab you want to record."
	};
	if (activeRecordings.has(tabId)) return {
		success: false,
		error: "Recording already in progress for this tab"
	};
	const tabInfo = store.getState().tabs.get(tabId);
	if (!tabInfo || tabInfo.state !== "connected") return {
		success: false,
		error: "Tab is not connected"
	};
	logger.debug("Starting recording for tab:", tabId, "params:", params);
	try {
		await ensureOffscreenDocument();
		const streamId = await new Promise((resolve, reject) => {
			chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
				if (chrome.runtime.lastError) {
					const errorMsg = chrome.runtime.lastError.message || "Unknown error";
					if (errorMsg.includes("Extension has not been invoked") || errorMsg.includes("activeTab")) reject(/* @__PURE__ */ new Error(`${errorMsg}. Click the Penguin Browser extension icon on this tab to enable recording.`));
					else reject(new Error(errorMsg));
				} else if (!id) reject(/* @__PURE__ */ new Error("Failed to get media stream ID"));
				else resolve(id);
			});
		});
		logger.debug("Got stream ID for tab:", tabId, "streamId:", streamId.substring(0, 20) + "...");
		const result = await chrome.runtime.sendMessage({
			action: "startRecording",
			tabId,
			streamId,
			frameRate: params.frameRate ?? 30,
			videoBitsPerSecond: params.videoBitsPerSecond ?? 25e5,
			audioBitsPerSecond: params.audioBitsPerSecond ?? 128e3,
			audio: params.audio ?? false
		});
		if (!result.success) return {
			success: false,
			error: result.error || "Failed to start recording in offscreen document"
		};
		const startedAt = result.startedAt || Date.now();
		activeRecordings.set(tabId, {
			tabId,
			startedAt
		});
		updateTabRecordingState(tabId, true);
		logger.debug("Recording started for tab:", tabId, "mimeType:", result.mimeType);
		return {
			success: true,
			tabId,
			startedAt,
			mimeType: result.mimeType
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error("Failed to start recording:", error);
		return {
			success: false,
			error: errorMessage
		};
	}
}
async function handleStopRecording(params) {
	const tabId = resolveTabIdFromSessionId(params.sessionId);
	if (!tabId) return {
		success: false,
		error: "No connected tab found"
	};
	const recording = activeRecordings.get(tabId);
	if (!recording) return {
		success: false,
		error: "No active recording for this tab"
	};
	logger.debug("Stopping recording for tab:", tabId);
	try {
		const result = await chrome.runtime.sendMessage({
			action: "stopRecording",
			tabId
		});
		if (!result.success) return {
			success: false,
			error: result.error || "Failed to stop recording in offscreen document"
		};
		const duration = result.duration || Date.now() - recording.startedAt;
		activeRecordings.delete(tabId);
		updateTabRecordingState(tabId, false);
		logger.debug("Recording stopped for tab:", tabId, "duration:", duration);
		return {
			success: true,
			tabId,
			duration
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error("Failed to stop recording:", error);
		return {
			success: false,
			error: errorMessage
		};
	}
}
async function handleIsRecording(params) {
	const tabId = resolveTabIdFromSessionId(params.sessionId);
	if (!tabId) return { isRecording: false };
	const recording = activeRecordings.get(tabId);
	if (!recording) return {
		isRecording: false,
		tabId
	};
	try {
		return {
			isRecording: (await chrome.runtime.sendMessage({
				action: "isRecording",
				tabId
			})).isRecording,
			tabId,
			startedAt: recording.startedAt
		};
	} catch {
		return {
			isRecording: false,
			tabId
		};
	}
}
async function handleCancelRecording(params) {
	const tabId = resolveTabIdFromSessionId(params.sessionId);
	if (!tabId) return {
		success: false,
		error: "No connected tab found"
	};
	if (!activeRecordings.get(tabId)) return { success: true };
	logger.debug("Cancelling recording for tab:", tabId);
	try {
		await chrome.runtime.sendMessage({
			action: "cancelRecording",
			tabId
		});
		activeRecordings.delete(tabId);
		updateTabRecordingState(tabId, false);
		if (connectionManager.ws?.readyState === WebSocket.OPEN) sendMessage({
			method: "recordingCancelled",
			params: { tabId }
		});
		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logger.error("Failed to cancel recording:", error);
		return {
			success: false,
			error: errorMessage
		};
	}
}
/**
* Clean up recordings when tab is disconnected.
*/
async function cleanupRecordingForTab(tabId) {
	if (activeRecordings.get(tabId)) {
		logger.debug("Cleaning up recording for disconnected tab:", tabId);
		try {
			await chrome.runtime.sendMessage({
				action: "cancelRecording",
				tabId
			});
		} catch (e) {
			logger.debug("Error cleaning up recording:", e);
		}
		activeRecordings.delete(tabId);
	}
}
//#endregion
//#region src/tab-debugger-operation-queue.ts
/**
* Serializes debugger attach/detach operations independently for every tab.
*
* Consecutive operations of the same kind are coalesced. An intervening
* operation always creates a new queue entry, so attach -> detach -> attach
* cannot accidentally reuse the first attach promise.
*/
var TabDebuggerOperationQueue = class {
	entries = /* @__PURE__ */ new Map();
	attach(tabId, operation) {
		const current = this.entries.get(tabId);
		if (current?.lastKind === "attach" && current.attachPromise) return current.attachPromise;
		const attachPromise = this.enqueue(tabId, operation);
		this.setEntry(tabId, {
			tail: attachPromise.then(() => void 0, () => void 0),
			lastKind: "attach",
			attachPromise
		});
		return attachPromise;
	}
	detach(tabId, operation) {
		const current = this.entries.get(tabId);
		if (current?.lastKind === "detach" && current.detachPromise) return current.detachPromise;
		const detachPromise = this.enqueue(tabId, operation);
		this.setEntry(tabId, {
			tail: detachPromise.then(() => void 0, () => void 0),
			lastKind: "detach",
			detachPromise
		});
		return detachPromise;
	}
	enqueue(tabId, operation) {
		return (this.entries.get(tabId)?.tail ?? Promise.resolve()).then(operation);
	}
	setEntry(tabId, entry) {
		this.entries.set(tabId, entry);
		entry.tail.then(() => {
			if (this.entries.get(tabId) === entry) this.entries.delete(tabId);
		});
	}
};
//#endregion
//#region src/background.ts
var js = dedent;
var RELAY_HOST = "127.0.0.1";
var RELAY_PORT = 19992;
var FAST_CDP_COMMAND_TIMEOUT_MS = /* @__PURE__ */ new Map([
	["Browser.getWindowForTarget", 1e4],
	["Page.enable", 1e4],
	["Page.getFrameTree", 1e4],
	["Page.setLifecycleEventsEnabled", 1e4],
	["Page.createIsolatedWorld", 1e4],
	["Page.setDownloadBehavior", 1e4],
	["Log.enable", 1e4],
	["Network.enable", 1e4],
	["Emulation.setFocusEmulationEnabled", 1e4],
	["Emulation.setEmulatedMedia", 1e4],
	["Runtime.runIfWaitingForDebugger", 1e4],
	["Target.setAutoAttach", 1e4]
]);
async function sendCommandWithTimeout(debuggee, method, params, timeout) {
	let timeoutId;
	try {
		return await Promise.race([chrome.debugger.sendCommand(debuggee, method, params), new Promise((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(/* @__PURE__ */ new Error(`CDP command timed out after ${timeout}ms: ${method} (tab may be frozen/hibernated)`));
			}, timeout);
		})]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function createInstallId() {
	const values = /* @__PURE__ */ new Uint32Array(2);
	crypto.getRandomValues(values);
	return Array.from(values).map((value) => {
		return value.toString(36);
	}).join("");
}
function browserNameFromBrands(brands) {
	const brandNames = brands.map((brand) => {
		return brand.brand.trim().toLowerCase();
	});
	if (brandNames.some((brand) => brand === "brave")) return "Brave";
	if (brandNames.some((brand) => brand === "microsoft edge")) return "Edge";
	if (brandNames.some((brand) => brand === "opera")) return "Opera";
	if (brandNames.some((brand) => brand === "vivaldi")) return "Vivaldi";
	if (brandNames.some((brand) => brand === "google chrome canary")) return "Chrome Canary";
	if (brandNames.some((brand) => brand === "google chrome")) return "Chrome";
	if (brandNames.some((brand) => brand === "chromium")) return "Chromium";
	return null;
}
async function detectBrowserName() {
	if (chrome.ghostPublicAPI) return "Ghost";
	const navigatorWithUaData = navigator;
	const brands = navigatorWithUaData.userAgentData?.brands;
	const highEntropyName = browserNameFromBrands((await navigatorWithUaData.userAgentData?.getHighEntropyValues?.(["fullVersionList"]).catch(() => {
		return null;
	}))?.fullVersionList || []);
	if (highEntropyName) return highEntropyName;
	if (brands && brands.length > 0) {
		const lowEntropyName = browserNameFromBrands(brands);
		if (lowEntropyName) return lowEntropyName;
	}
	const ua = navigator.userAgent.toLowerCase();
	if (ua.includes("edg/")) return "Edge";
	if (ua.includes("opr/")) return "Opera";
	if (ua.includes("vivaldi")) return "Vivaldi";
	if (ua.includes("brave")) return "Brave";
	if (ua.includes("chrome")) return "Chrome";
	return "Chromium";
}
var identityPromise = null;
var installIdPromise = null;
var tabSessionScope = (() => {
	const values = /* @__PURE__ */ new Uint32Array(2);
	crypto.getRandomValues(values);
	return Array.from(values).map((value) => {
		return value.toString(36);
	}).join("");
})();
async function getInstallId() {
	if (installIdPromise) return installIdPromise;
	installIdPromise = (async () => {
		const existing = await chrome.storage.local.get("penguinBrowserInstallId");
		const storedInstallId = typeof existing.penguinBrowserInstallId === "string" ? existing.penguinBrowserInstallId : "";
		if (storedInstallId) return storedInstallId;
		const installId = createInstallId();
		await chrome.storage.local.set({ penguinBrowserInstallId: installId });
		return installId;
	})().catch((error) => {
		installIdPromise = null;
		throw error;
	});
	return installIdPromise;
}
async function getExtensionIdentity() {
	if (identityPromise) return identityPromise;
	identityPromise = (async () => {
		const browser = await detectBrowserName();
		const installId = await getInstallId().catch(() => {
			return tabSessionScope;
		});
		try {
			const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
			return {
				browser,
				email: info.email || "",
				id: info.id || "",
				installId
			};
		} catch {
			return {
				browser,
				email: "",
				id: "",
				installId
			};
		}
	})();
	return identityPromise;
}
var TAB_GROUP_COLOR = "cyan";
var TAB_GROUP_TITLE = "penguin-browser";
var OWNED_TAB_GROUPS_STORAGE_KEY = "penguinBrowserOwnedTabGroupsByWindow";
var childSessions = /* @__PURE__ */ new Map();
var nextSessionId = 1;
var tabGroupQueue = Promise.resolve();
var ownedTabGroupsPromise;
var autoAttachParams = null;
var recordingChunkBuffer = [];
var MAX_RECORDING_CHUNK_BUFFER_BYTES = 8388608;
var recordingChunkBufferBytes = 0;
var abortedBufferedRecordings = /* @__PURE__ */ new Set();
function removeBufferedRecordingChunks(tabId) {
	for (let index = recordingChunkBuffer.length - 1; index >= 0; index--) {
		const chunk = recordingChunkBuffer[index];
		if (chunk.tabId !== tabId) continue;
		recordingChunkBufferBytes -= chunk.data?.length ?? 0;
		recordingChunkBuffer.splice(index, 1);
	}
	recordingChunkBufferBytes = Math.max(0, recordingChunkBufferBytes);
}
/**
* Flush buffered recording chunks to the WebSocket.
* Called when WebSocket becomes ready.
*/
function flushRecordingChunkBuffer(ws) {
	if (recordingChunkBuffer.length === 0) return;
	logger.debug(`Flushing ${recordingChunkBuffer.length} buffered recording chunks`);
	while (recordingChunkBuffer.length > 0) {
		const { tabId, data, final, cancelled } = recordingChunkBuffer.shift();
		recordingChunkBufferBytes = Math.max(0, recordingChunkBufferBytes - (data?.length ?? 0));
		if (cancelled) {
			ws.send(JSON.stringify({
				method: "recordingCancelled",
				params: { tabId }
			}));
			abortedBufferedRecordings.delete(tabId);
			continue;
		}
		ws.send(JSON.stringify({
			method: "recordingData",
			params: {
				tabId,
				final
			}
		}));
		if (data && !final) {
			const buffer = new Uint8Array(data);
			ws.send(buffer);
		}
	}
}
var ConnectionManager = class {
	ws = null;
	connectionPromise = null;
	preserveTabsOnDetach = false;
	async ensureConnection() {
		if (this.ws?.readyState === WebSocket.OPEN) return;
		if (store.getState().connectionState === "extension-replaced") throw new Error("Another Penguin Browser extension is already connected");
		if (this.connectionPromise) return this.connectionPromise;
		const GLOBAL_TIMEOUT_MS = 2e4;
		const abortController = new AbortController();
		let globalTimeout;
		this.connectionPromise = Promise.race([this.connect(abortController.signal), new Promise((_, reject) => {
			globalTimeout = setTimeout(() => {
				abortController.abort();
				reject(/* @__PURE__ */ new Error("Connection timeout"));
			}, GLOBAL_TIMEOUT_MS);
		})]);
		try {
			await this.connectionPromise;
		} finally {
			if (globalTimeout) clearTimeout(globalTimeout);
			this.connectionPromise = null;
		}
	}
	async connect(abortSignal) {
		logger.debug(`Waiting for server at http://${RELAY_HOST}:${RELAY_PORT}...`);
		const maxAttempts = 5;
		for (let attempt = 0; attempt < maxAttempts; attempt++) try {
			await fetch(`http://${RELAY_HOST}:${RELAY_PORT}`, {
				method: "HEAD",
				signal: AbortSignal.any([abortSignal, AbortSignal.timeout(2e3)])
			});
			logger.debug("Server is available");
			break;
		} catch {
			if (abortSignal.aborted) throw new Error("Connection timeout");
			if (attempt === 4) throw new Error("Server not available");
			logger.debug(`Server not available, retrying... (attempt ${attempt + 1}/${maxAttempts})`);
			await sleep(1e3);
			if (abortSignal.aborted) throw new Error("Connection timeout");
		}
		const identity = await getExtensionIdentity();
		if (abortSignal.aborted) throw new Error("Connection timeout");
		const relayUrl = new URL(`ws://${RELAY_HOST}:${RELAY_PORT}/extension`);
		if (identity.browser) relayUrl.searchParams.set("browser", identity.browser);
		if (identity.email) relayUrl.searchParams.set("email", identity.email);
		if (identity.id) relayUrl.searchParams.set("id", identity.id);
		if (identity.installId) relayUrl.searchParams.set("installId", identity.installId);
		relayUrl.searchParams.set("v", "0.4.0");
		logger.debug("Creating WebSocket connection to:", relayUrl);
		const socket = new WebSocket(relayUrl.toString());
		await new Promise((resolve, reject) => {
			let settled = false;
			const settle = (callback) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				abortSignal.removeEventListener("abort", onAbort);
				callback();
			};
			const onAbort = () => {
				settle(() => {
					try {
						socket.close();
					} catch {}
					reject(/* @__PURE__ */ new Error("Connection timeout"));
				});
			};
			const timeout = setTimeout(() => {
				settle(() => {
					logger.debug("WebSocket connection TIMEOUT after 5 seconds");
					try {
						socket.close();
					} catch {}
					reject(/* @__PURE__ */ new Error("Connection timeout"));
				});
			}, 5e3);
			abortSignal.addEventListener("abort", onAbort, { once: true });
			socket.onopen = () => {
				settle(() => {
					logger.debug("WebSocket connected");
					flushRecordingChunkBuffer(socket);
					resolve();
				});
			};
			socket.onerror = (error) => {
				logger.debug("WebSocket error during connection:", error);
				settle(() => reject(/* @__PURE__ */ new Error("WebSocket connection failed")));
			};
			socket.onclose = (event) => {
				logger.debug("WebSocket closed during connection:", {
					code: event.code,
					reason: event.reason
				});
				settle(() => {
					if (event.code === 4002 || event.reason === "Extension Already In Use") reject(/* @__PURE__ */ new Error("Extension Already In Use"));
					else reject(/* @__PURE__ */ new Error(`WebSocket closed: ${event.reason || event.code}`));
				});
			};
		});
		if (abortSignal.aborted) {
			socket.close();
			throw new Error("Connection timeout");
		}
		this.ws = socket;
		this.ws.onmessage = async (event) => {
			let message;
			try {
				message = JSON.parse(event.data);
			} catch (error) {
				logger.debug("Error parsing message:", error);
				sendMessage({ error: {
					code: -32700,
					message: `Error parsing message: ${error.message}`
				} });
				return;
			}
			if (message.method === "ping") {
				sendMessage({ method: "pong" });
				return;
			}
			if (message.method === "createInitialTab") {
				try {
					logger.debug("Creating initial tab for Playwright client");
					const tab = await createTabInPreferredWindow({
						url: "about:blank",
						active: false
					});
					if (tab.id) {
						setTabConnecting(tab.id);
						const { targetInfo, sessionId } = await attachTab(tab.id, { skipAttachedEvent: true });
						logger.debug("Initial tab created and connected:", tab.id, "sessionId:", sessionId);
						sendMessage({
							id: message.id,
							result: {
								success: true,
								tabId: tab.id,
								sessionId,
								targetInfo
							}
						});
					} else throw new Error("Failed to create tab - no tab ID returned");
				} catch (error) {
					logger.debug("Failed to create initial tab:", error);
					sendMessage({
						id: message.id,
						error: error.message
					});
				}
				return;
			}
			if (message.method === "startRecording") {
				try {
					const result = await handleStartRecording(message.params);
					sendMessage({
						id: message.id,
						result
					});
				} catch (error) {
					logger.error("Failed to start recording:", error);
					sendMessage({
						id: message.id,
						result: {
							success: false,
							error: error.message
						}
					});
				}
				return;
			}
			if (message.method === "stopRecording") {
				try {
					const result = await handleStopRecording(message.params);
					sendMessage({
						id: message.id,
						result
					});
				} catch (error) {
					logger.error("Failed to stop recording:", error);
					sendMessage({
						id: message.id,
						result: {
							success: false,
							error: error.message
						}
					});
				}
				return;
			}
			if (message.method === "isRecording") {
				try {
					const result = await handleIsRecording(message.params);
					sendMessage({
						id: message.id,
						result
					});
				} catch (error) {
					logger.error("Failed to check recording status:", error);
					sendMessage({
						id: message.id,
						result: { isRecording: false }
					});
				}
				return;
			}
			if (message.method === "cancelRecording") {
				try {
					const result = await handleCancelRecording(message.params);
					sendMessage({
						id: message.id,
						result
					});
				} catch (error) {
					logger.error("Failed to cancel recording:", error);
					sendMessage({
						id: message.id,
						result: {
							success: false,
							error: error.message
						}
					});
				}
				return;
			}
			if (message.method === "ghost-browser") {
				const params = message.params;
				const result = await handleGhostBrowserCommand(params, chrome);
				if (!result.success) logger.error("Ghost Browser API error:", result.error);
				if (result.success && params.namespace === "ghostPublicAPI" && params.method === "openTab") {
					const tabId = result.result;
					if (tabId) {
						logger.debug("Auto-connecting Ghost Browser tab:", tabId);
						setTabConnecting(tabId);
						await sleep(100);
						await attachTab(tabId);
					}
				}
				sendMessage({
					id: message.id,
					result
				});
				return;
			}
			const response = { id: message.id };
			try {
				response.result = await handleCommand(message);
			} catch (error) {
				logger.debug("Error handling command:", error);
				response.error = error.message;
			}
			sendMessage(response);
		};
		this.ws.onclose = (event) => {
			this.handleClose(event.reason, event.code);
		};
		this.ws.onerror = (event) => {
			logger.debug("WebSocket error:", event);
		};
		chrome.debugger.onEvent.addListener(onDebuggerEvent);
		chrome.debugger.onDetach.addListener(onDebuggerDetach);
		logger.debug("Connection established");
	}
	handleClose(reason, code) {
		try {
			const mem = performance.memory;
			if (mem) {
				const formatMB = (b) => (b / 1024 / 1024).toFixed(2) + "MB";
				logger.warn(`DISCONNECT MEMORY: used=${formatMB(mem.usedJSHeapSize)} total=${formatMB(mem.totalJSHeapSize)} limit=${formatMB(mem.jsHeapSizeLimit)}`);
			}
		} catch {}
		logger.warn(`DISCONNECT: WS closed code=${code} reason=${reason || "none"} stack=${getCallStack()}`);
		chrome.debugger.onEvent.removeListener(onDebuggerEvent);
		chrome.debugger.onDetach.removeListener(onDebuggerDetach);
		const isExtensionReplaced = reason === "Extension Replaced" || code === 4001;
		const isExtensionInUse = reason === "Extension Already In Use" || code === 4002;
		this.preserveTabsOnDetach = !(isExtensionReplaced || isExtensionInUse);
		const { tabs } = store.getState();
		for (const [tabId] of tabs) detachDebugger(tabId).catch((err) => {
			logger.debug("Error detaching from tab:", tabId, err.message);
		});
		childSessions.clear();
		this.ws = null;
		if (isExtensionReplaced) {
			logger.debug("Disconnected: another Penguin Browser extension connected (this one was idle)");
			store.setState({
				tabs: /* @__PURE__ */ new Map(),
				connectionState: "extension-replaced",
				errorText: "Another Penguin Browser extension took over the connection"
			});
			return;
		}
		if (isExtensionInUse) {
			logger.debug("Rejected: another Penguin Browser extension is actively in use");
			store.setState({
				tabs: /* @__PURE__ */ new Map(),
				connectionState: "extension-replaced",
				errorText: "Another Penguin Browser extension is actively in use"
			});
			return;
		}
		store.setState((state) => {
			const newTabs = new Map(state.tabs);
			for (const [tabId, tab] of newTabs) newTabs.set(tabId, {
				...tab,
				state: "connecting"
			});
			return {
				tabs: newTabs,
				connectionState: "idle",
				errorText: void 0
			};
		});
	}
	async maintainLoop() {
		while (true) {
			if (this.ws?.readyState === WebSocket.OPEN) {
				await sleep(1e3);
				continue;
			}
			if (store.getState().connectionState === "extension-replaced") {
				try {
					const identity = await getExtensionIdentity();
					const statusUrl = new URL(`http://${RELAY_HOST}:${RELAY_PORT}/extension/status`);
					if (identity.browser) statusUrl.searchParams.set("browser", identity.browser);
					if (identity.email) statusUrl.searchParams.set("email", identity.email);
					if (identity.id) statusUrl.searchParams.set("id", identity.id);
					if (identity.installId) statusUrl.searchParams.set("installId", identity.installId);
					const data = await (await fetch(statusUrl, {
						method: "GET",
						signal: AbortSignal.timeout(2e3)
					})).json();
					if (!data.connected) {
						store.setState({
							connectionState: "idle",
							errorText: void 0
						});
						logger.debug("Extension slot is free (connected:", data.connected, "activeTargets:", data.activeTargets, "), cleared error state");
					} else logger.debug("Extension slot still taken (activeTargets:", data.activeTargets, "), will retry...");
				} catch {
					logger.debug("Server not available, will retry...");
				}
				await sleep(3e3);
				continue;
			}
			const currentTabs = store.getState().tabs;
			if (Array.from(currentTabs.values()).some((t) => t.state === "connected")) store.setState((state) => {
				const newTabs = new Map(state.tabs);
				for (const [tabId, tab] of newTabs) if (tab.state === "connected") newTabs.set(tabId, {
					...tab,
					state: "connecting"
				});
				return { tabs: newTabs };
			});
			try {
				await this.ensureConnection();
				store.setState({ connectionState: "connected" });
				const tabsToReattach = Array.from(store.getState().tabs.entries()).filter(([_, tab]) => tab.state === "connecting").map(([tabId]) => tabId);
				for (const tabId of tabsToReattach) {
					const currentTab = store.getState().tabs.get(tabId);
					if (!currentTab || currentTab.state !== "connecting") {
						logger.debug("Skipping reattach, tab state changed:", tabId, currentTab?.state);
						continue;
					}
					try {
						await chrome.tabs.get(tabId);
						await attachTab(tabId);
						logger.debug("Successfully re-attached tab:", tabId);
					} catch (error) {
						logger.debug("Failed to re-attach tab:", tabId, error.message);
						store.setState((state) => {
							const newTabs = new Map(state.tabs);
							newTabs.delete(tabId);
							return { tabs: newTabs };
						});
					}
				}
				this.preserveTabsOnDetach = false;
			} catch (error) {
				logger.debug("Connection attempt failed:", error.message);
				if (error.message === "Extension Already In Use") store.setState({
					connectionState: "extension-replaced",
					errorText: "Another Penguin Browser extension is actively in use"
				});
				else store.setState({ connectionState: "idle" });
			}
			await sleep(3e3);
		}
	}
};
var connectionManager = new ConnectionManager();
var store = createStore(() => ({
	tabs: /* @__PURE__ */ new Map(),
	connectionState: "idle",
	currentTabId: void 0,
	preferredWindowId: void 0,
	errorText: void 0
}));
globalThis.toggleExtensionForActiveTab = toggleExtensionForActiveTab;
globalThis.disconnectEverything = disconnectEverything;
globalThis.getExtensionState = () => store.getState();
var MAX_LOG_STRING_LENGTH = 2e3;
function truncateLogString(value) {
	if (value.length <= MAX_LOG_STRING_LENGTH) return value;
	return `${value.slice(0, MAX_LOG_STRING_LENGTH)}…[truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`;
}
function safeSerialize(arg) {
	if (arg === void 0) return "undefined";
	if (arg === null) return "null";
	if (typeof arg === "function") return `[Function: ${arg.name || "anonymous"}]`;
	if (typeof arg === "symbol") return String(arg);
	if (typeof arg === "string") return truncateLogString(arg);
	if (arg instanceof Error) return truncateLogString(arg.stack || arg.message || String(arg));
	if (typeof arg === "object") try {
		const seen = /* @__PURE__ */ new WeakSet();
		return truncateLogString(JSON.stringify(arg, (key, value) => {
			if (typeof value === "object" && value !== null) {
				if (seen.has(value)) return "[Circular]";
				seen.add(value);
				if (value instanceof Map) return {
					dataType: "Map",
					value: Array.from(value.entries())
				};
				if (value instanceof Set) return {
					dataType: "Set",
					value: Array.from(value.values())
				};
			}
			return value;
		}));
	} catch {
		return truncateLogString(String(arg));
	}
	return truncateLogString(String(arg));
}
function sendLog(level, args) {
	sendMessage({
		method: "log",
		params: {
			level,
			args: args.map(safeSerialize)
		}
	});
}
var logger = {
	log: (...args) => {
		console.log(...args);
		sendLog("log", args);
	},
	debug: (...args) => {
		console.debug(...args);
		sendLog("debug", args);
	},
	info: (...args) => {
		console.info(...args);
		sendLog("info", args);
	},
	warn: (...args) => {
		console.warn(...args);
		sendLog("warn", args);
	},
	error: (...args) => {
		console.error(...args);
		sendLog("error", args);
	}
};
function getCallStack() {
	return ((/* @__PURE__ */ new Error()).stack || "").split("\n").slice(2, 6).join(" <- ").replace(/\s+/g, " ");
}
self.addEventListener("error", (event) => {
	const stack = event.error?.stack || `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`;
	logger.error("Uncaught error:", stack);
});
self.addEventListener("unhandledrejection", (event) => {
	const reason = event.reason;
	const stack = reason?.stack || String(reason);
	logger.error("Unhandled promise rejection:", stack);
});
var messageCount = 0;
function sendMessage(message) {
	if (connectionManager.ws?.readyState === WebSocket.OPEN) try {
		connectionManager.ws.send(JSON.stringify(message));
		if (++messageCount % 100 === 0) checkMemory();
	} catch (error) {
		console.debug("ERROR sending message:", error, "message type:", message.method || "response");
	}
}
async function getPreferredWindowId() {
	const { preferredWindowId, currentTabId } = store.getState();
	if (preferredWindowId !== void 0) try {
		await chrome.windows.get(preferredWindowId);
		return preferredWindowId;
	} catch {
		store.setState({ preferredWindowId: void 0 });
	}
	if (currentTabId !== void 0) try {
		const tab = await chrome.tabs.get(currentTabId);
		if (tab.windowId !== void 0) return tab.windowId;
	} catch {}
	try {
		return (await chrome.windows.getLastFocused({ populate: false })).id;
	} catch {
		return;
	}
}
async function createTabInPreferredWindow(options) {
	const windowId = await getPreferredWindowId();
	const createProperties = {
		url: options.url,
		active: options.active,
		...windowId !== void 0 ? { windowId } : {}
	};
	try {
		return await chrome.tabs.create(createProperties);
	} catch (error) {
		logger.debug("Could not create tab in preferred window, falling back:", error.message);
		return await chrome.tabs.create({
			url: options.url,
			active: options.active
		});
	}
}
async function getOwnedTabGroups() {
	if (!ownedTabGroupsPromise) ownedTabGroupsPromise = (async () => {
		try {
			const value = (await chrome.storage.session.get(OWNED_TAB_GROUPS_STORAGE_KEY))[OWNED_TAB_GROUPS_STORAGE_KEY];
			const groups = /* @__PURE__ */ new Map();
			if (value && typeof value === "object" && !Array.isArray(value)) for (const [windowIdValue, groupIdValue] of Object.entries(value)) {
				const windowId = Number(windowIdValue);
				if (Number.isInteger(windowId) && typeof groupIdValue === "number" && Number.isInteger(groupIdValue)) groups.set(windowId, groupIdValue);
			}
			return groups;
		} catch (error) {
			logger.debug("Could not restore owned tab groups:", error.message);
			return /* @__PURE__ */ new Map();
		}
	})();
	return await ownedTabGroupsPromise;
}
async function persistOwnedTabGroups(groups) {
	try {
		await chrome.storage.session.set({ [OWNED_TAB_GROUPS_STORAGE_KEY]: Object.fromEntries(Array.from(groups.entries()).map(([windowId, groupId]) => [String(windowId), groupId])) });
	} catch (error) {
		logger.debug("Could not persist owned tab groups:", error.message);
	}
}
async function rememberOwnedTabGroup(windowId, groupId) {
	const groups = await getOwnedTabGroups();
	if (groups.get(windowId) === groupId) return;
	groups.set(windowId, groupId);
	await persistOwnedTabGroups(groups);
}
async function forgetOwnedTabGroup(windowId, expectedGroupId) {
	const groups = await getOwnedTabGroups();
	if (!groups.has(windowId)) return;
	if (expectedGroupId !== void 0 && groups.get(windowId) !== expectedGroupId) return;
	groups.delete(windowId);
	await persistOwnedTabGroups(groups);
}
async function getValidatedOwnedTabGroupId(windowId) {
	const groupId = (await getOwnedTabGroups()).get(windowId);
	if (groupId === void 0) return void 0;
	try {
		const group = await chrome.tabGroups.get(groupId);
		if (group.windowId === windowId) return groupId;
		logger.debug("Discarding owned tab group with mismatched window:", groupId, group.windowId, windowId);
	} catch {
		logger.debug("Discarding missing owned tab group:", groupId, "for window:", windowId);
	}
	await forgetOwnedTabGroup(windowId, groupId);
}
async function syncTabGroup() {
	try {
		const { connectionState } = store.getState();
		const isRelayConnected = connectionState === "connected";
		const connectedTabIds = Array.from(store.getState().tabs.entries()).filter(([_, info]) => info.state === "connected" || info.state === "connecting" && isRelayConnected).map(([tabId]) => tabId);
		const allTabs = await chrome.tabs.query({});
		const connectedTabIdSet = new Set(connectedTabIds);
		const connectedTabsByWindow = /* @__PURE__ */ new Map();
		for (const tab of allTabs) {
			if (tab.id === void 0 || !connectedTabIdSet.has(tab.id)) continue;
			const tabIds = connectedTabsByWindow.get(tab.windowId) ?? [];
			tabIds.push(tab.id);
			connectedTabsByWindow.set(tab.windowId, tabIds);
		}
		const ownedGroups = await getOwnedTabGroups();
		const windowIds = /* @__PURE__ */ new Set([...ownedGroups.keys(), ...connectedTabsByWindow.keys()]);
		for (const windowId of windowIds) {
			const desiredTabIds = connectedTabsByWindow.get(windowId) ?? [];
			let groupId = await getValidatedOwnedTabGroupId(windowId);
			if (desiredTabIds.length === 0) {
				if (groupId === void 0) continue;
				const tabIdsToUngroup = (await chrome.tabs.query({ groupId })).map((tab) => tab.id).filter((id) => id !== void 0);
				if (tabIdsToUngroup.length > 0) await chrome.tabs.ungroup(tabIdsToUngroup);
				await forgetOwnedTabGroup(windowId, groupId);
				logger.debug("Cleared owned penguin-browser group:", groupId, "in window:", windowId);
				continue;
			}
			if (groupId === void 0) {
				groupId = await chrome.tabs.group({
					tabIds: desiredTabIds,
					createProperties: { windowId }
				});
				await rememberOwnedTabGroup(windowId, groupId);
				await chrome.tabGroups.update(groupId, {
					title: TAB_GROUP_TITLE,
					color: TAB_GROUP_COLOR
				});
				logger.debug("Created owned tab group:", groupId, "in window:", windowId, "with tabs:", desiredTabIds);
				continue;
			}
			const tabsInGroup = await chrome.tabs.query({ groupId });
			const tabIdsInGroup = new Set(tabsInGroup.map((tab) => tab.id).filter((id) => id !== void 0));
			const desiredTabIdSet = new Set(desiredTabIds);
			const tabsToAdd = desiredTabIds.filter((tabId) => !tabIdsInGroup.has(tabId));
			const tabsToRemove = Array.from(tabIdsInGroup).filter((tabId) => !desiredTabIdSet.has(tabId));
			if (tabsToAdd.length > 0) {
				await chrome.tabs.group({
					tabIds: tabsToAdd,
					groupId
				});
				logger.debug("Added tabs to owned group:", groupId, tabsToAdd);
			}
			if (tabsToRemove.length > 0) {
				await chrome.tabs.ungroup(tabsToRemove);
				logger.debug("Removed tabs from owned group:", groupId, tabsToRemove);
			}
			await chrome.tabGroups.update(groupId, {
				title: TAB_GROUP_TITLE,
				color: TAB_GROUP_COLOR
			});
		}
	} catch (error) {
		logger.debug("Failed to sync tab group:", error.message);
	}
}
function getTabBySessionId(sessionId) {
	for (const [tabId, tab] of store.getState().tabs) if (tab.sessionId === sessionId) return {
		tabId,
		tab
	};
}
function getTabByTargetId(targetId) {
	for (const [tabId, tab] of store.getState().tabs) if (tab.targetId === targetId) return {
		tabId,
		tab
	};
}
function emitChildDetachesForTab(tabId) {
	Array.from(childSessions.entries()).filter(([_, parentTab]) => parentTab.tabId === tabId).forEach(([childSessionId, parentTab]) => {
		sendMessage({
			method: "forwardCDPEvent",
			params: {
				method: "Target.detachedFromTarget",
				params: parentTab.targetId ? {
					sessionId: childSessionId,
					targetId: parentTab.targetId
				} : { sessionId: childSessionId }
			}
		});
		logger.debug("Cleaning up child session:", childSessionId, "for tab:", tabId);
		childSessions.delete(childSessionId);
	});
}
function getTabForCommand(msg) {
	const sessionId = msg.params.sessionId;
	if (sessionId) {
		const found = getTabBySessionId(sessionId);
		if (found) return found;
		const child = childSessions.get(sessionId);
		if (child) {
			const tab = store.getState().tabs.get(child.tabId);
			if (tab) return {
				tabId: child.tabId,
				tab
			};
		}
	}
	const paramsSessionId = msg.params.params && "sessionId" in msg.params.params && typeof msg.params.params.sessionId === "string" ? msg.params.params.sessionId : void 0;
	if (paramsSessionId) {
		const found = getTabBySessionId(paramsSessionId);
		if (found) return found;
		const child = childSessions.get(paramsSessionId);
		if (child) {
			const tab = store.getState().tabs.get(child.tabId);
			if (tab) return {
				tabId: child.tabId,
				tab
			};
		}
	}
	const targetId = msg.params.params && "targetId" in msg.params.params && typeof msg.params.params.targetId === "string" ? msg.params.params.targetId : void 0;
	if (targetId) return getTabByTargetId(targetId);
}
async function handleCommand(msg) {
	if (msg.method !== "forwardCDPCommand") return;
	const resolved = getTabForCommand(msg);
	let targetTabId = resolved?.tabId;
	let targetTab = resolved?.tab;
	const debuggee = targetTabId ? { tabId: targetTabId } : void 0;
	if (msg.params.method === "Target.setAutoAttach" && !msg.params.sessionId) {
		const params = msg.params.params;
		if (!params) return {};
		autoAttachParams = params;
		const connectedTabIds = Array.from(store.getState().tabs.entries()).filter(([_, info]) => info.state === "connected").map(([tabId]) => tabId);
		await Promise.all(connectedTabIds.map(async (tabId) => {
			try {
				await sendCommandWithTimeout({ tabId }, "Target.setAutoAttach", params, 1e4);
			} catch (error) {
				logger.debug("Failed to set auto-attach for tab:", tabId, error);
			}
		}));
		return {};
	}
	switch (msg.params.method) {
		case "Runtime.enable": {
			if (!debuggee) throw new Error(`No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`);
			const runtimeSession = {
				...debuggee,
				sessionId: msg.params.sessionId !== targetTab?.sessionId ? msg.params.sessionId : void 0
			};
			try {
				await sendCommandWithTimeout(runtimeSession, "Runtime.disable", void 0, 1e4);
				await sleep(50);
			} catch (e) {
				logger.debug("Error disabling Runtime (ignoring):", e);
			}
			return await sendCommandWithTimeout(runtimeSession, "Runtime.enable", msg.params.params, 1e4);
		}
		case "Target.createTarget": {
			const url = msg.params.params?.url || "about:blank";
			logger.debug("Creating new tab with URL:", url);
			const tab = await createTabInPreferredWindow({
				url,
				active: false
			});
			if (!tab.id) throw new Error("Failed to create tab");
			setTabConnecting(tab.id);
			logger.debug("Created tab:", tab.id, "waiting for it to load...");
			await sleep(100);
			const { targetInfo } = await attachTab(tab.id);
			return { targetId: targetInfo.targetId };
		}
		case "Target.closeTarget":
			if (!targetTabId) {
				logger.log(`Target not found: ${msg.params.params?.targetId}`);
				return { success: false };
			}
			await chrome.tabs.remove(targetTabId);
			return { success: true };
		case "Page.setDownloadBehavior":
			if (!debuggee) throw new Error(`No debuggee found for Page.setDownloadBehavior (sessionId: ${msg.params.sessionId})`);
			try {
				return await sendCommandWithTimeout(debuggee, msg.params.method, msg.params.params, 1e4);
			} catch (error) {
				if ((error instanceof Error ? error.message : String(error)).includes("Cannot not access browser-level commands")) return {};
				throw error;
			}
	}
	if (!debuggee || !targetTab) {
		if (msg.params.method === "Target.detachFromTarget") return {};
		throw new Error(`No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId} params: ${JSON.stringify(msg.params.params || null)}`);
	}
	logger.debug("CDP command:", msg.params.method, "for tab:", targetTabId);
	const debuggerSession = {
		...debuggee,
		sessionId: msg.params.sessionId !== targetTab.sessionId ? msg.params.sessionId : void 0
	};
	const timeout = FAST_CDP_COMMAND_TIMEOUT_MS.get(msg.params.method);
	if (timeout) return await sendCommandWithTimeout(debuggerSession, msg.params.method, msg.params.params, timeout);
	return await chrome.debugger.sendCommand(debuggerSession, msg.params.method, msg.params.params);
}
var DROPPED_CDP_EVENTS = /* @__PURE__ */ new Set(["Network.dataReceived", "Network.resourceChangedPriority"]);
function onDebuggerEvent(source, method, params) {
	if (DROPPED_CDP_EVENTS.has(method)) return;
	const tab = source.tabId ? store.getState().tabs.get(source.tabId) : void 0;
	if (!tab) return;
	logger.debug("Forwarding CDP event:", method, "from tab:", source.tabId);
	if (method === "Target.attachedToTarget" && params?.sessionId) {
		const targetUrl = params.targetInfo?.url;
		if (isRestrictedUrl(targetUrl)) {
			logger.debug("Ignoring restricted child target:", targetUrl, "sessionId:", params.sessionId, "for tab:", source.tabId);
			if (source.tabId) chrome.debugger.sendCommand({ tabId: source.tabId }, "Target.detachFromTarget", { sessionId: params.sessionId }).catch((e) => {
				logger.debug("Failed to detach restricted child target (expected):", e);
			});
			return;
		}
		logger.debug("Child target attached:", params.sessionId, "for tab:", source.tabId);
		const targetId = params.targetInfo?.targetId;
		childSessions.set(params.sessionId, {
			tabId: source.tabId,
			targetId
		});
	}
	if (method === "Target.detachedFromTarget" && params?.sessionId) {
		const mainTab = getTabBySessionId(params.sessionId);
		if (mainTab) {
			logger.debug("Main tab detached via CDP event:", mainTab.tabId, "sessionId:", params.sessionId);
			store.setState((state) => {
				const newTabs = new Map(state.tabs);
				newTabs.delete(mainTab.tabId);
				return { tabs: newTabs };
			});
			emitChildDetachesForTab(mainTab.tabId);
		} else {
			logger.debug("Child target detached:", params.sessionId);
			childSessions.delete(params.sessionId);
		}
	}
	sendMessage({
		method: "forwardCDPEvent",
		params: {
			sessionId: source.sessionId || tab.sessionId,
			method,
			params
		}
	});
}
function onDebuggerDetach(source, reason) {
	const tabId = source.tabId;
	if (!tabId || !store.getState().tabs.has(tabId)) {
		logger.debug("Ignoring debugger detach event for untracked tab:", tabId);
		return;
	}
	if (reason === chrome.debugger.DetachReason.CANCELED_BY_USER) {
		logger.warn(`DISCONNECT: Chrome debugger canceled by user tabId=${tabId}`);
		for (const [detachedTabId, tab] of store.getState().tabs.entries()) {
			restoreRestrictedIframes(detachedTabId);
			if (tab.sessionId && tab.targetId) sendMessage({
				method: "forwardCDPEvent",
				params: {
					method: "Target.detachedFromTarget",
					params: {
						sessionId: tab.sessionId,
						targetId: tab.targetId
					}
				}
			});
			emitChildDetachesForTab(detachedTabId);
		}
		connectionManager.preserveTabsOnDetach = false;
		store.setState({
			tabs: /* @__PURE__ */ new Map(),
			connectionState: "idle",
			errorText: void 0
		});
		return;
	}
	if (connectionManager.preserveTabsOnDetach) {
		logger.debug("Ignoring debugger detach during relay reconnect:", tabId, reason);
		return;
	}
	logger.warn(`DISCONNECT: onDebuggerDetach tabId=${tabId} reason=${reason}`);
	const detachTabFromPlaywright = (detachedTabId, tab) => {
		if (tab.sessionId && tab.targetId) sendMessage({
			method: "forwardCDPEvent",
			params: {
				method: "Target.detachedFromTarget",
				params: {
					sessionId: tab.sessionId,
					targetId: tab.targetId
				}
			}
		});
		emitChildDetachesForTab(detachedTabId);
	};
	const tab = store.getState().tabs.get(tabId);
	if (tab) {
		if (tab.state === "connected") restoreRestrictedIframes(tabId);
		detachTabFromPlaywright(tabId, tab);
	}
	store.setState((state) => {
		const newTabs = new Map(state.tabs);
		newTabs.delete(tabId);
		return { tabs: newTabs };
	});
}
async function temporarilyRemoveRestrictedIframes(tabId) {
	try {
		const totalRemoved = (await chrome.scripting.executeScript({
			target: {
				tabId,
				allFrames: true
			},
			func: (ownExtIds) => {
				const collectOpenRoots = (root) => {
					return [root, ...Array.from(root.querySelectorAll("*")).flatMap((element) => {
						return element.shadowRoot ? collectOpenRoots(element.shadowRoot) : [];
					})];
				};
				const isolatedGlobal = globalThis;
				const pending = isolatedGlobal.__penguinBrowserPendingRestrictedIframes || [];
				const markerOwner = ownExtIds[0] || "penguin-browser";
				const newPending = collectOpenRoots(document).flatMap((root) => {
					return Array.from(root.querySelectorAll("iframe")).filter((iframe) => {
						const src = iframe.src || iframe.getAttribute("src") || "";
						if (!src.startsWith("chrome-extension://")) return false;
						const extId = src.replace("chrome-extension://", "").split("/")[0];
						return !ownExtIds.includes(extId);
					});
				}).flatMap((iframe) => {
					const parent = iframe.parentNode;
					if (!parent) return [];
					const marker = document.createElement("template");
					marker.setAttribute("data-penguin-browser-restricted-iframe", markerOwner);
					const nextSibling = iframe.nextSibling;
					iframe.replaceWith(marker);
					marker.content.append(iframe);
					return [{
						iframe,
						marker,
						parent,
						nextSibling
					}];
				});
				isolatedGlobal.__penguinBrowserPendingRestrictedIframes = [...pending, ...newPending];
				return newPending.length;
			},
			args: [OUR_EXTENSION_IDS]
		})).reduce((sum, r) => sum + (r.result ?? 0), 0);
		if (totalRemoved > 0) logger.debug(`Temporarily removed ${totalRemoved} restricted chrome-extension:// iframe(s) from tab:`, tabId);
		return totalRemoved;
	} catch (e) {
		logger.debug("Could not remove restricted iframes (expected on some pages):", e.message);
		return 0;
	}
}
async function restoreRestrictedIframes(tabId) {
	try {
		const totalRestored = (await chrome.scripting.executeScript({
			target: {
				tabId,
				allFrames: true
			},
			func: (markerOwner) => {
				const collectOpenRoots = (root) => {
					return [root, ...Array.from(root.querySelectorAll("*")).flatMap((element) => {
						return element.shadowRoot ? collectOpenRoots(element.shadowRoot) : [];
					})];
				};
				const isolatedGlobal = globalThis;
				const pending = isolatedGlobal.__penguinBrowserPendingRestrictedIframes || [];
				isolatedGlobal.__penguinBrowserPendingRestrictedIframes = [];
				return pending.reduce((restored, record) => {
					if (record.iframe.isConnected) {
						record.marker.remove();
						return restored;
					}
					if (record.marker.parentNode) {
						record.marker.replaceWith(record.iframe);
						return restored + 1;
					}
					const referenceNode = record.nextSibling?.parentNode === record.parent ? record.nextSibling : null;
					record.parent.insertBefore(record.iframe, referenceNode);
					return restored + 1;
				}, 0) + collectOpenRoots(document).flatMap((root) => {
					return Array.from(root.querySelectorAll("template")).filter((template) => {
						return template.getAttribute("data-penguin-browser-restricted-iframe") === markerOwner;
					});
				}).reduce((restored, marker) => {
					const iframe = marker.content.querySelector("iframe");
					if (!iframe) {
						marker.remove();
						return restored;
					}
					marker.replaceWith(iframe);
					return restored + 1;
				}, 0);
			},
			args: [chrome.runtime.id]
		})).reduce((sum, result) => sum + (result.result ?? 0), 0);
		if (totalRestored > 0) logger.debug(`Restored ${totalRestored} restricted chrome-extension:// iframe(s) in tab:`, tabId);
		return totalRestored;
	} catch (e) {
		logger.debug("Could not restore restricted iframes (expected after navigation/close):", e.message);
		return 0;
	}
}
var tabDebuggerOperations = new TabDebuggerOperationQueue();
var ATTACH_CDP_COMMAND_TIMEOUT_MS = 1e4;
async function attachTab(tabId, options = {}) {
	return tabDebuggerOperations.attach(tabId, async () => {
		return await attachTabImpl(tabId, options);
	});
}
function detachDebugger(tabId) {
	return tabDebuggerOperations.detach(tabId, async () => {
		try {
			await chrome.debugger.detach({ tabId });
		} finally {
			await restoreRestrictedIframes(tabId);
		}
	});
}
async function attachTabImpl(tabId, { skipAttachedEvent = false } = {}) {
	const debuggee = { tabId };
	let debuggerAttached = false;
	let attachCompleted = false;
	try {
		logger.debug("Attaching debugger to tab:", tabId);
		const maxAttachAttempts = 3;
		for (let attempt = 1; attempt <= maxAttachAttempts; attempt++) try {
			await chrome.debugger.attach(debuggee, "1.3");
			break;
		} catch (attachError) {
			const msg = attachError.message ?? "";
			if (!(msg.includes("chrome-extension://") || msg.includes("different extension")) || attempt === maxAttachAttempts) throw attachError;
			logger.debug(`Debugger attach blocked by chrome-extension:// iframe (attempt ${attempt}/${maxAttachAttempts}), removing and retrying:`, tabId);
			await temporarilyRemoveRestrictedIframes(tabId);
			await sleep(50);
		}
		debuggerAttached = true;
		logger.debug("Debugger attached successfully to tab:", tabId);
		await sendCommandWithTimeout(debuggee, "Page.enable", void 0, ATTACH_CDP_COMMAND_TIMEOUT_MS);
		if (autoAttachParams) try {
			await sendCommandWithTimeout(debuggee, "Target.setAutoAttach", autoAttachParams, ATTACH_CDP_COMMAND_TIMEOUT_MS);
		} catch (error) {
			logger.debug("Failed to apply auto-attach for tab:", tabId, error);
		}
		const contextMenuScript = js`
      document.addEventListener('contextmenu', (e) => {
        window.__penguinBrowser_lastRightClicked = e.target;
      }, true);
    `;
		await sendCommandWithTimeout(debuggee, "Page.addScriptToEvaluateOnNewDocument", { source: contextMenuScript }, ATTACH_CDP_COMMAND_TIMEOUT_MS);
		await sendCommandWithTimeout(debuggee, "Runtime.evaluate", { expression: contextMenuScript }, ATTACH_CDP_COMMAND_TIMEOUT_MS);
		try {
			await sendCommandWithTimeout(debuggee, "Page.addScriptToEvaluateOnNewDocument", { source: ghost_cursor_client_default }, ATTACH_CDP_COMMAND_TIMEOUT_MS);
			await sendCommandWithTimeout(debuggee, "Runtime.evaluate", { expression: ghost_cursor_client_default }, ATTACH_CDP_COMMAND_TIMEOUT_MS);
		} catch (err) {
			logger.debug("Could not inject ghost cursor (restricted page):", err.message);
		}
		const targetInfo = (await sendCommandWithTimeout(debuggee, "Target.getTargetInfo", void 0, ATTACH_CDP_COMMAND_TIMEOUT_MS)).targetInfo;
		if (!targetInfo.url || targetInfo.url === "" || targetInfo.url === ":") logger.error("WARNING: Target.attachedToTarget will be sent with empty URL! tabId:", tabId, "targetInfo:", JSON.stringify(targetInfo));
		const attachOrder = nextSessionId;
		const sessionId = `pw-tab-${tabSessionScope}-${nextSessionId++}`;
		store.setState((state) => {
			const newTabs = new Map(state.tabs);
			newTabs.set(tabId, {
				sessionId,
				targetId: targetInfo.targetId,
				state: "connected",
				attachOrder
			});
			return {
				tabs: newTabs,
				connectionState: "connected",
				errorText: void 0
			};
		});
		if (!skipAttachedEvent) sendMessage({
			method: "forwardCDPEvent",
			params: {
				method: "Target.attachedToTarget",
				params: {
					sessionId,
					targetInfo: {
						...targetInfo,
						attached: true
					},
					waitingForDebugger: false
				}
			}
		});
		logger.debug("Tab attached successfully:", tabId, "sessionId:", sessionId, "targetId:", targetInfo.targetId, "url:", targetInfo.url, "skipAttachedEvent:", skipAttachedEvent);
		chrome.scripting.executeScript({
			target: {
				tabId,
				allFrames: false
			},
			world: "MAIN",
			func: initPenguinBrowserToolbar,
			args: [chrome.runtime.getURL("icons/penguin-browser-icon-black.png")]
		}).catch((err) => {
			logger.debug("Could not inject toolbar (restricted page):", err.message);
		});
		attachCompleted = true;
		return {
			targetInfo,
			sessionId
		};
	} catch (error) {
		if (debuggerAttached) {
			logger.debug("Cleaning up debugger after partial attach failure:", tabId);
			try {
				await chrome.debugger.detach(debuggee);
			} catch {}
		}
		throw error;
	} finally {
		if (!attachCompleted) await restoreRestrictedIframes(tabId);
	}
}
async function detachTab(tabId, shouldDetachDebugger) {
	const tab = store.getState().tabs.get(tabId);
	if (!tab) {
		logger.debug("detachTab: tab not found in map:", tabId);
		await restoreRestrictedIframes(tabId);
		return;
	}
	cleanupRecordingForTab(tabId);
	chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func: () => {
			window.__penguinBrowserToolbarDestroy?.();
		}
	}).catch(() => {});
	chrome.scripting.executeScript({
		target: { tabId },
		world: "MAIN",
		func: () => {
			globalThis.__penguinBrowserGhostCursor?.disable?.();
		}
	}).catch(() => {});
	logger.warn(`DISCONNECT: detachTab tabId=${tabId} shouldDetach=${shouldDetachDebugger} stack=${getCallStack()}`);
	store.setState((state) => {
		const newTabs = new Map(state.tabs);
		newTabs.delete(tabId);
		return { tabs: newTabs };
	});
	await tabDebuggerOperations.detach(tabId, async () => {
		const attachedDuringDisconnect = store.getState().tabs.get(tabId);
		const tabToDetach = attachedDuringDisconnect?.sessionId ? attachedDuringDisconnect : tab;
		if (tabToDetach.sessionId && tabToDetach.targetId) sendMessage({
			method: "forwardCDPEvent",
			params: {
				method: "Target.detachedFromTarget",
				params: {
					sessionId: tabToDetach.sessionId,
					targetId: tabToDetach.targetId
				}
			}
		});
		store.setState((state) => {
			const newTabs = new Map(state.tabs);
			newTabs.delete(tabId);
			return { tabs: newTabs };
		});
		emitChildDetachesForTab(tabId);
		if (shouldDetachDebugger) try {
			await chrome.debugger.detach({ tabId });
		} catch (err) {
			logger.debug("Error detaching debugger from tab:", tabId, err.message);
		}
		await restoreRestrictedIframes(tabId);
	});
}
async function connectTab(tabId) {
	try {
		logger.debug(`Starting connection to tab ${tabId}`);
		setTabConnecting(tabId);
		await connectionManager.ensureConnection();
		await attachTab(tabId);
		logger.debug(`Successfully connected to tab ${tabId}`);
	} catch (error) {
		logger.debug(`Failed to connect to tab ${tabId}:`, error);
		const isExtensionInUse = error.message === "Extension Already In Use" || error.message === "Another Penguin Browser extension is already connected";
		const isWsError = error.message === "Server not available" || error.message === "Connection timeout" || error.message.startsWith("WebSocket");
		if (isExtensionInUse) {
			logger.debug(`Another extension is in use, entering polling mode`);
			store.setState((state) => {
				const newTabs = new Map(state.tabs);
				newTabs.delete(tabId);
				return {
					tabs: newTabs,
					connectionState: "extension-replaced",
					errorText: "Another Penguin Browser extension is actively in use"
				};
			});
		} else if (isWsError) logger.debug(`WS connection failed, keeping tab ${tabId} in connecting state for retry`);
		else {
			let tabStillExists = true;
			try {
				await chrome.tabs.get(tabId);
			} catch {
				tabStillExists = false;
			}
			if (!tabStillExists) {
				logger.debug(`Tab ${tabId} was closed during connect, dropping error state`);
				store.setState((state) => {
					const newTabs = new Map(state.tabs);
					newTabs.delete(tabId);
					return { tabs: newTabs };
				});
				return;
			}
			if (!store.getState().tabs.has(tabId)) {
				logger.debug(`Tab ${tabId} was detached during connect, dropping error state`);
				return;
			}
			store.setState((state) => {
				const newTabs = new Map(state.tabs);
				newTabs.set(tabId, {
					state: "error",
					errorText: `Error: ${error.message}`
				});
				return { tabs: newTabs };
			});
		}
	}
}
function setTabConnecting(tabId) {
	store.setState((state) => {
		const newTabs = new Map(state.tabs);
		const existing = newTabs.get(tabId);
		newTabs.set(tabId, {
			...existing,
			state: "connecting"
		});
		return { tabs: newTabs };
	});
}
async function disconnectTab(tabId) {
	logger.debug(`Disconnecting tab ${tabId}`);
	const { tabs } = store.getState();
	if (!tabs.has(tabId)) {
		logger.debug("Tab not in tabs map, ignoring disconnect");
		await restoreRestrictedIframes(tabId);
		return;
	}
	await detachTab(tabId, true);
}
async function toggleExtensionForActiveTab() {
	const tab = (await chrome.tabs.query({
		active: true,
		currentWindow: true
	}))[0];
	if (!tab?.id) throw new Error("No active tab found");
	await onActionClicked(tab);
	await new Promise((resolve) => {
		const check = () => {
			if (store.getState().tabs.get(tab.id)?.state === "connecting") {
				setTimeout(check, 100);
				return;
			}
			resolve();
		};
		check();
	});
	const state = store.getState();
	return {
		isConnected: state.tabs.has(tab.id) && state.tabs.get(tab.id)?.state === "connected",
		state
	};
}
async function disconnectEverything() {
	tabGroupQueue = tabGroupQueue.then(async () => {
		const { tabs } = store.getState();
		for (const tabId of tabs.keys()) await disconnectTab(tabId);
	});
	await tabGroupQueue;
}
async function resetDebugger() {
	let targets = await chrome.debugger.getTargets();
	targets = targets.filter((x) => x.tabId && x.attached);
	logger.log(`found ${targets.length} existing debugger targets. detaching them before background script starts`);
	for (const target of targets) await detachDebugger(target.tabId);
}
var OUR_EXTENSION_IDS = [chrome.runtime.id];
function isRestrictedUrl(url) {
	if (!url) return false;
	if (url.startsWith("chrome-extension://")) {
		const extensionId = url.replace("chrome-extension://", "").split("/")[0];
		return !OUR_EXTENSION_IDS.includes(extensionId);
	}
	return [
		"chrome://",
		"devtools://",
		"edge://",
		"https://chrome.google.com/",
		"https://chromewebstore.google.com/"
	].some((prefix) => url.startsWith(prefix));
}
var icons = {
	connected: {
		path: {
			"16": "/icons/icon-green-16.png",
			"32": "/icons/icon-green-32.png",
			"48": "/icons/icon-green-48.png",
			"128": "/icons/icon-green-128.png"
		},
		title: "Connected - Click to disconnect",
		badgeText: "",
		badgeColor: [
			64,
			64,
			64,
			255
		]
	},
	connecting: {
		path: {
			"16": "/icons/icon-gray-16.png",
			"32": "/icons/icon-gray-32.png",
			"48": "/icons/icon-gray-48.png",
			"128": "/icons/icon-gray-128.png"
		},
		title: "Waiting for MCP WS server...",
		badgeText: "...",
		badgeColor: [
			64,
			64,
			64,
			255
		]
	},
	idle: {
		path: {
			"16": "/icons/icon-black-16.png",
			"32": "/icons/icon-black-32.png",
			"48": "/icons/icon-black-48.png",
			"128": "/icons/icon-black-128.png"
		},
		title: "Click to attach debugger",
		badgeText: "",
		badgeColor: [
			64,
			64,
			64,
			255
		]
	},
	restricted: {
		path: {
			"16": "/icons/icon-gray-16.png",
			"32": "/icons/icon-gray-32.png",
			"48": "/icons/icon-gray-48.png",
			"128": "/icons/icon-gray-128.png"
		},
		title: "Cannot attach to this page",
		badgeText: "",
		badgeColor: [
			64,
			64,
			64,
			255
		]
	},
	extensionReplaced: {
		path: {
			"16": "/icons/icon-gray-16.png",
			"32": "/icons/icon-gray-32.png",
			"48": "/icons/icon-gray-48.png",
			"128": "/icons/icon-gray-128.png"
		},
		title: "Another Penguin Browser extension connected - Click to retry",
		badgeText: "!",
		badgeColor: [
			220,
			38,
			38,
			255
		]
	},
	tabError: {
		path: {
			"16": "/icons/icon-gray-16.png",
			"32": "/icons/icon-gray-32.png",
			"48": "/icons/icon-gray-48.png",
			"128": "/icons/icon-gray-128.png"
		},
		title: "Error",
		badgeText: "!",
		badgeColor: [
			220,
			38,
			38,
			255
		]
	}
};
function settleChromeApiCall(promise, operation) {
	if (!promise) return;
	promise.catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("browser is shutting down")) return;
		logger.debug(`Chrome API call failed (${operation}):`, message);
	});
}
async function updateIcons() {
	try {
		const { connectionState, tabs, errorText } = store.getState();
		const connectedCount = Array.from(tabs.values()).filter((t) => t.state === "connected").length;
		const allTabs = await chrome.tabs.query({});
		const tabUrlMap = new Map(allTabs.map((tab) => [tab.id, tab.url]));
		const allTabIds = [void 0, ...allTabs.map((tab) => tab.id).filter((id) => id !== void 0)];
		for (const tabId of allTabIds) {
			const tabInfo = tabId !== void 0 ? tabs.get(tabId) : void 0;
			const tabUrl = tabId !== void 0 ? tabUrlMap.get(tabId) : void 0;
			const iconConfig = (() => {
				if (connectionState === "extension-replaced") return icons.extensionReplaced;
				if (tabId !== void 0 && isRestrictedUrl(tabUrl)) return icons.restricted;
				if (tabInfo?.state === "error") return icons.tabError;
				if (tabInfo?.state === "connecting") return icons.connecting;
				if (tabInfo?.state === "connected") return icons.connected;
				return icons.idle;
			})();
			const title = (() => {
				if (connectionState === "extension-replaced" && errorText) return errorText;
				if (tabInfo?.errorText) return tabInfo.errorText;
				return iconConfig.title;
			})();
			const badgeText = (() => {
				if (iconConfig === icons.connected || iconConfig === icons.idle || iconConfig === icons.restricted) return connectedCount > 0 ? String(connectedCount) : "";
				return iconConfig.badgeText;
			})();
			settleChromeApiCall(chrome.action.setIcon({
				tabId,
				path: iconConfig.path
			}), "setIcon");
			settleChromeApiCall(chrome.action.setTitle({
				tabId,
				title
			}), "setTitle");
			if (iconConfig.badgeColor) settleChromeApiCall(chrome.action.setBadgeBackgroundColor({
				tabId,
				color: iconConfig.badgeColor
			}), "setBadgeBackgroundColor");
			settleChromeApiCall(chrome.action.setBadgeText({
				tabId,
				text: badgeText
			}), "setBadgeText");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes("browser is shutting down")) logger.debug("Failed to update extension icons:", message);
	}
}
async function onTabRemoved(tabId) {
	popupSourceTabMap.delete(tabId);
	const { tabs } = store.getState();
	if (!tabs.has(tabId)) return;
	logger.debug(`Connected tab ${tabId} was closed, disconnecting`);
	await disconnectTab(tabId);
}
async function onTabActivated(activeInfo) {
	store.setState({
		currentTabId: activeInfo.tabId,
		preferredWindowId: activeInfo.windowId
	});
}
async function onActionClicked(tab) {
	if (!tab.id) {
		logger.debug("No tab ID available");
		return;
	}
	if (tab.windowId !== void 0) store.setState({
		currentTabId: tab.id,
		preferredWindowId: tab.windowId
	});
	if (isRestrictedUrl(tab.url)) {
		logger.debug("Cannot attach to restricted URL:", tab.url);
		return;
	}
	const { tabs, connectionState } = store.getState();
	const tabInfo = tabs.get(tab.id);
	if (connectionState === "extension-replaced") {
		logger.debug("Clearing extension-replaced state, attempting to reconnect");
		store.setState({
			connectionState: "idle",
			errorText: void 0
		});
		await connectTab(tab.id);
		return;
	}
	if (tabInfo?.state === "error") {
		logger.debug("Tab has error - disconnecting to clear state");
		await disconnectTab(tab.id);
		return;
	}
	if (tabInfo?.state === "connecting") {
		logger.debug("Tab is already connecting, ignoring click");
		return;
	}
	if (tabInfo?.state === "connected") await disconnectTab(tab.id);
	else await connectTab(tab.id);
}
resetDebugger().catch((error) => {
	logger.debug("Failed to reset existing debugger targets:", error.message);
}).finally(() => {
	connectionManager.maintainLoop();
});
chrome.contextMenus.remove("penguin-browser-pin-element").catch(() => {}).finally(() => {
	chrome.contextMenus?.create({
		id: "penguin-browser-pin-element",
		title: "Copy Penguin Browser Element Reference",
		contexts: ["all"],
		visible: false
	});
});
chrome.contextMenus.remove("penguin-browser-copy-react-source").catch(() => {}).finally(() => {
	chrome.contextMenus?.create({
		id: "penguin-browser-copy-react-source",
		title: "Copy React Component Source Path",
		contexts: ["all"],
		visible: false
	});
});
function updateContextMenuVisibility() {
	const { currentTabId, tabs } = store.getState();
	const isConnected = currentTabId !== void 0 && tabs.get(currentTabId)?.state === "connected";
	settleChromeApiCall(chrome.contextMenus?.update("penguin-browser-pin-element", { visible: isConnected }), "update pin context menu");
	settleChromeApiCall(chrome.contextMenus?.update("penguin-browser-copy-react-source", { visible: isConnected }), "update React context menu");
}
function buildPinnedElementInspectionCode(options) {
	return `inspectPinnedElement(${JSON.stringify(options.url).replace(/'/g, "\\u0027")},"globalThis.${options.pinName}")`;
}
chrome.runtime.onInstalled.addListener((details) => {});
function serializeTabs(tabs) {
	return JSON.stringify(Array.from(tabs.entries()));
}
store.subscribe((state, prevState) => {
	logger.log(state);
	updateIcons();
	updateContextMenuVisibility();
	if (serializeTabs(state.tabs) !== serializeTabs(prevState.tabs)) tabGroupQueue = tabGroupQueue.then(syncTabGroup).catch((e) => {
		logger.debug("syncTabGroup error:", e);
	});
});
logger.debug(`Using relay host: ${RELAY_HOST}, port: ${RELAY_PORT}`);
var lastMemoryUsage = 0;
var lastMemoryCheck = Date.now();
var MEMORY_WARNING_THRESHOLD = 52428800;
var MEMORY_CRITICAL_THRESHOLD = 104857600;
var MEMORY_GROWTH_THRESHOLD = 10485760;
function checkMemory() {
	try {
		const memory = performance.memory;
		if (!memory) return;
		const used = memory.usedJSHeapSize;
		const total = memory.totalJSHeapSize;
		const limit = memory.jsHeapSizeLimit;
		const now = Date.now();
		const timeDelta = now - lastMemoryCheck;
		const memoryDelta = used - lastMemoryUsage;
		const formatMB = (bytes) => (bytes / 1024 / 1024).toFixed(2) + "MB";
		const growthRate = timeDelta > 0 ? memoryDelta / timeDelta * 1e3 : 0;
		if (used > MEMORY_CRITICAL_THRESHOLD) logger.error(`MEMORY CRITICAL: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`);
		else if (used > MEMORY_WARNING_THRESHOLD) logger.warn(`MEMORY WARNING: used=${formatMB(used)} total=${formatMB(total)} limit=${formatMB(limit)} growth=${formatMB(memoryDelta)} rate=${formatMB(growthRate)}/s`);
		else if (memoryDelta > MEMORY_GROWTH_THRESHOLD && timeDelta < 6e4) logger.warn(`MEMORY SPIKE: grew ${formatMB(memoryDelta)} in ${(timeDelta / 1e3).toFixed(1)}s (used=${formatMB(used)})`);
		lastMemoryUsage = used;
		lastMemoryCheck = now;
	} catch (e) {}
}
setInterval(checkMemory, 5e3);
checkMemory();
chrome.tabs.onRemoved.addListener(onTabRemoved);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.action.onClicked.addListener(onActionClicked);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	updateIcons();
	if (changeInfo.groupId !== void 0) tabGroupQueue = tabGroupQueue.then(async () => {
		let currentTab;
		try {
			currentTab = await chrome.tabs.get(tabId);
		} catch {
			return;
		}
		const ownedGroupId = (await getOwnedTabGroups()).get(currentTab.windowId);
		if (ownedGroupId === void 0) return;
		const { tabs } = store.getState();
		if (currentTab.groupId === ownedGroupId) {
			if (await getValidatedOwnedTabGroupId(currentTab.windowId) === void 0) return;
			if (!tabs.has(tabId) && !isRestrictedUrl(currentTab.url)) {
				logger.debug("Tab manually added to owned penguin-browser group:", tabId);
				await connectTab(tabId);
			}
		} else if (tabs.has(tabId)) {
			if (tabs.get(tabId)?.state === "connecting") {
				logger.debug("Tab removed from group while connecting, ignoring:", tabId);
				return;
			}
			logger.debug("Tab manually removed from owned penguin-browser group:", tabId);
			await disconnectTab(tabId);
		}
	}).catch((e) => {
		logger.debug("onTabUpdated handler error:", e);
	});
});
var popupSourceTabMap = /* @__PURE__ */ new Map();
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
	popupSourceTabMap.set(details.tabId, details.sourceTabId);
	setTimeout(() => {
		popupSourceTabMap.delete(details.tabId);
	}, 1e4);
	(async () => {
		if (!store.getState().tabs.has(details.sourceTabId)) return;
		try {
			await sleep(50);
			const tab = await chrome.tabs.get(details.tabId);
			if ((await chrome.windows.get(tab.windowId, { populate: false })).type === "popup") return;
			if (isRestrictedUrl(details.url || tab.url)) return;
			if (store.getState().tabs.has(details.tabId)) return;
			logger.debug(`Auto-connecting child tab ${details.tabId} opened by connected tab ${details.sourceTabId}`);
			await connectTab(details.tabId);
			popupSourceTabMap.delete(details.tabId);
		} catch (error) {
			logger.warn(`Failed to auto-connect child tab ${details.tabId}:`, error);
		}
	})();
});
chrome.windows.onCreated.addListener(async (popupWindow) => {
	if (popupWindow.type !== "popup" || popupWindow.id === void 0) return;
	try {
		let popupTabs = [];
		for (let attempt = 0; attempt < 5; attempt++) {
			popupTabs = await chrome.tabs.query({ windowId: popupWindow.id });
			if (popupTabs.length > 0) break;
			await sleep(20);
		}
		const tabIds = popupTabs.map((t) => t.id).filter((id) => {
			return id !== void 0;
		});
		if (tabIds.length === 0) {
			logger.debug(`Popup window ${popupWindow.id} has no tabs after retry, skipping`);
			return;
		}
		const { tabs: connectedTabs } = store.getState();
		let sourceTabId;
		for (const tabId of tabIds) {
			const candidate = popupSourceTabMap.get(tabId);
			if (candidate !== void 0 && connectedTabs.has(candidate)) {
				sourceTabId = candidate;
				break;
			}
		}
		for (const tabId of tabIds) popupSourceTabMap.delete(tabId);
		if (sourceTabId === void 0) {
			logger.debug(`Popup window ${popupWindow.id} not opened by a Penguin Browser-connected tab, leaving alone (tabs=${JSON.stringify(tabIds)})`);
			return;
		}
		let destinationWindowId;
		try {
			const sourceTab = await chrome.tabs.get(sourceTabId);
			if (sourceTab.windowId === void 0) {
				const focused = await chrome.windows.getLastFocused({ populate: false });
				if (focused.id === void 0 || focused.id === popupWindow.id) return;
				destinationWindowId = focused.id;
			} else destinationWindowId = sourceTab.windowId;
		} catch (e) {
			logger.debug(`Source tab ${sourceTabId} no longer exists, skipping relocation:`, e);
			return;
		}
		logger.debug(`Relocating ${tabIds.length} popup tab(s) from window ${popupWindow.id} into source window ${destinationWindowId} (sourceTabId=${sourceTabId})`);
		await chrome.tabs.move(tabIds, {
			windowId: destinationWindowId,
			index: -1
		});
		try {
			await chrome.windows.remove(popupWindow.id);
		} catch {}
		for (const tabId of tabIds) {
			if (connectedTabs.has(tabId)) continue;
			try {
				await connectTab(tabId);
			} catch (e) {
				logger.warn(`Failed to auto-connect relocated popup tab ${tabId}:`, e);
			}
		}
	} catch (e) {
		logger.warn("Failed to relocate popup window:", e);
	}
});
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) return;
	const tabInfo = store.getState().tabs.get(tab.id);
	if (!tabInfo || tabInfo.state !== "connected") {
		logger.debug("Tab not connected, ignoring");
		return;
	}
	const debuggee = { tabId: tab.id };
	if (info.menuItemId === "penguin-browser-pin-element") try {
		const jsAllocatePin = js`
        (function() {
          window.__penguinBrowserPinCount = (window.__penguinBrowserPinCount || 0) + 1;
          return window.__penguinBrowserPinCount;
        })()
      `;
		const name = `penguinBrowserPinnedElem${(await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: jsAllocatePin,
			returnByValue: true
		})).result?.value ?? 1}`;
		const jsAssignPin = js`
        if (window.__penguinBrowser_lastRightClicked) {
          window.${name} = window.__penguinBrowser_lastRightClicked;
          '${name}';
        } else {
          throw new Error('No element was right-clicked');
        }
      `;
		const result = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: jsAssignPin,
			returnByValue: true
		});
		if (result.exceptionDetails) {
			logger.error("Failed to pin element:", result.exceptionDetails.text);
			return;
		}
		const clipboardText = "penguin-browser -e '" + buildPinnedElementInspectionCode({
			pinName: name,
			url: tab.url || ""
		}) + "'";
		const jsPinFlashAndCopy = js`
        (() => {
          const el = window.${name};
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `;
		await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: jsPinFlashAndCopy,
			awaitPromise: true,
			userGesture: true
		});
		logger.debug("Pinned element as:", name);
	} catch (error) {
		logger.error("Failed to pin element:", error.message);
	}
	if (info.menuItemId === "penguin-browser-copy-react-source") try {
		if (!(await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: "!!globalThis.__bippy",
			returnByValue: true
		})).result?.value) await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: bippy_default });
		const jsResolveSource = js`
        (async () => {
          const el = window.__penguinBrowser_lastRightClicked;
          if (!el) return JSON.stringify({ error: 'No element was right-clicked' });

          const bippy = globalThis.__bippy;
          if (!bippy) return JSON.stringify({ error: 'bippy not loaded' });

          // bippy.normalizeFileName strips "/app-pages-browser/" but not the parenthesized
          // form "/(app-pages-browser)/" that Next.js webpack actually uses. This regex
          // strips all Next.js webpack layer prefixes: (app-pages-browser), (ssr), (rsc),
          // (action-browser), (pages-dir-browser), (pages-dir-edge), (pages-dir-node).
          // Also strips leading "./" that often follows the layer prefix.
          const cleanFileName = (name) => {
            let f = bippy.normalizeFileName(name);
            f = f.replace(/^\/?\\([-\\w]+\\)\\//, '');
            f = f.replace(/^\\.[\\/]/, '');
            return f;
          };

          let fiber;
          try { fiber = bippy.getFiberFromHostInstance(el); } catch {}
          if (!fiber) return JSON.stringify({ error: 'No React fiber found. Is this a React app?' });

          // Walk up to find nearest composite fiber with source info
          let current = fiber;
          for (let i = 0; i < 50 && current; i++) {
            try {
              if (bippy.isCompositeFiber(current)) {
                const source = await bippy.getSource(current);
                if (source && source.fileName && bippy.isSourceFile(source.fileName)) {
                  return JSON.stringify({
                    fileName: cleanFileName(source.fileName),
                    lineNumber: source.lineNumber || null,
                    columnNumber: source.columnNumber || null,
                    componentName: source.functionName || bippy.getDisplayName(current.type) || null,
                  });
                }
                // Try owner stack as fallback for this fiber
                const ownerStack = await bippy.getOwnerStack(current);
                for (const frame of ownerStack) {
                  if (frame.fileName && bippy.isSourceFile(frame.fileName)) {
                    return JSON.stringify({
                      fileName: cleanFileName(frame.fileName),
                      lineNumber: frame.lineNumber || null,
                      columnNumber: frame.columnNumber || null,
                      componentName: frame.functionName || bippy.getDisplayName(current.type) || null,
                    });
                  }
                }
              }
            } catch {}
            current = current.return;
          }
          return JSON.stringify({ error: 'No React source location found. Is this a dev build with source maps?' });
        })()
      `;
		const sourceResult = await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: jsResolveSource,
			returnByValue: true,
			awaitPromise: true
		});
		if (sourceResult.exceptionDetails) {
			logger.error("Failed to get React source:", sourceResult.exceptionDetails.text);
			return;
		}
		const parsed = JSON.parse(sourceResult.result?.value || "{}");
		if (!parsed.fileName && !parsed.error) parsed.error = "React source result missing fileName";
		if (parsed.error) {
			const jsFlashRed = js`
          (() => {
            const el = window.__penguinBrowser_lastRightClicked;
            if (!el) return;
            const orig = el.getAttribute('style') || '';
            el.setAttribute('style', orig + '; outline: 3px solid #ef4444 !important; outline-offset: 2px !important;');
            setTimeout(() => el.setAttribute('style', orig), 600);
          })()
        `;
			await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", { expression: jsFlashRed });
			logger.debug("React source not found:", parsed.error);
			return;
		}
		const clipboardText = (() => {
			if (parsed.lineNumber) return `${parsed.fileName}:${parsed.lineNumber}`;
			return parsed.fileName;
		})();
		const jsFlashGreenAndCopy = js`
        (() => {
          const el = window.__penguinBrowser_lastRightClicked;
          if (!el) return;
          const orig = el.getAttribute('style') || '';
          el.setAttribute('style', orig + '; outline: 3px solid #22c55e !important; outline-offset: 2px !important; box-shadow: 0 0 0 3px #22c55e !important;');
          setTimeout(() => el.setAttribute('style', orig), 300);
          return navigator.clipboard.writeText(${JSON.stringify(clipboardText)});
        })()
      `;
		await chrome.debugger.sendCommand(debuggee, "Runtime.evaluate", {
			expression: jsFlashGreenAndCopy,
			awaitPromise: true,
			userGesture: true
		});
		logger.debug("Copied React source path:", clipboardText, "component:", parsed.componentName);
	} catch (error) {
		logger.error("Failed to copy React source:", error.message);
	}
});
updateIcons();
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
	if (message.action === "recordingChunk") {
		const { tabId, data, final } = message;
		if (connectionManager.ws?.readyState === WebSocket.OPEN) {
			abortedBufferedRecordings.delete(tabId);
			sendMessage({
				method: "recordingData",
				params: {
					tabId,
					final
				}
			});
			if (data && !final) {
				const buffer = new Uint8Array(data);
				connectionManager.ws.send(buffer);
			}
		} else {
			if (abortedBufferedRecordings.has(tabId)) return false;
			const chunkBytes = Array.isArray(data) ? data.length : 0;
			if (recordingChunkBufferBytes + chunkBytes > MAX_RECORDING_CHUNK_BUFFER_BYTES) {
				logger.error(`Recording buffer exceeded ${MAX_RECORDING_CHUNK_BUFFER_BYTES} bytes for tab ${tabId}; cancelling recording`);
				abortedBufferedRecordings.add(tabId);
				removeBufferedRecordingChunks(tabId);
				cleanupRecordingForTab(tabId);
				return false;
			}
			logger.debug(`Buffering recording chunk for tab ${tabId} (WebSocket not ready)`);
			recordingChunkBuffer.push({
				tabId,
				data,
				final
			});
			recordingChunkBufferBytes += chunkBytes;
		}
		return false;
	}
	if (message.action === "recordingCancelled") {
		const { tabId } = message;
		getActiveRecordings().delete(tabId);
		store.setState((state) => {
			const newTabs = new Map(state.tabs);
			const existing = newTabs.get(tabId);
			if (existing) newTabs.set(tabId, {
				...existing,
				isRecording: false
			});
			return { tabs: newTabs };
		});
		if (connectionManager.ws?.readyState === WebSocket.OPEN) {
			sendMessage({
				method: "recordingCancelled",
				params: { tabId }
			});
			abortedBufferedRecordings.delete(tabId);
		} else {
			removeBufferedRecordingChunks(tabId);
			if (!recordingChunkBuffer.some((chunk) => chunk.tabId === tabId && chunk.cancelled)) recordingChunkBuffer.push({
				tabId,
				cancelled: true
			});
		}
		return false;
	}
	return false;
});
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
	if (details.frameId !== 0) return;
	const { tabs } = store.getState();
	const tabInfo = tabs.get(details.tabId);
	if (!tabInfo || tabInfo.state !== "connected") return;
	chrome.scripting.executeScript({
		target: {
			tabId: details.tabId,
			allFrames: false
		},
		world: "MAIN",
		func: initPenguinBrowserToolbar,
		args: [chrome.runtime.getURL("icons/penguin-browser-icon-black.png")]
	}).catch((err) => {
		logger.debug("Could not re-inject toolbar after navigation:", err.message);
	});
});
//#endregion
