import { invoke } from "@tauri-apps/api/core";
import "./pet.css";

interface PetState {
  name?: string;
  avatar?: string | null;
  text?: string;
  ts?: number;
}

const root = document.getElementById("pet-root") as HTMLElement;
const stage = document.getElementById("pet-stage") as HTMLElement;
const image = document.getElementById("pet-image") as HTMLImageElement;
const fallback = document.getElementById("pet-fallback") as HTMLElement;
const nameEl = document.getElementById("pet-name") as HTMLElement;
const bubble = document.getElementById("pet-bubble") as HTMLElement;
const menu = document.getElementById("pet-menu") as HTMLElement;

if (!root || !stage || !image || !fallback || !nameEl || !bubble || !menu) {
  throw new Error("PET_DOM_MISSING");
}

const LINES = ["在呢", "怎么啦？", "我在这儿", "嗯？", "想我啦？", "来啦来啦"];
let lastTs = 0;
let bubbleTimer: number | null = null;
let menuOpen = false;

function readState(): PetState {
  try {
    return JSON.parse(localStorage.getItem("pet.state") ?? "{}") as PetState;
  } catch {
    return {};
  }
}

function showBubble(text: string): void {
  const value = text.trim();
  if (!value) return;
  bubble.textContent = value.length > 90 ? `${value.slice(0, 90)}…` : value;
  bubble.hidden = false;
  if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    bubble.hidden = true;
    bubbleTimer = null;
  }, 5000);
}

function hideMenu(): void {
  menu.hidden = true;
  menuOpen = false;
}

function applyState(): void {
  const state = readState();
  const name = state.name?.trim() || "ta";
  nameEl.textContent = name;
  fallback.textContent = name.slice(0, 1);
  if (state.avatar) {
    image.src = state.avatar;
    image.hidden = false;
    fallback.hidden = true;
  } else {
    image.hidden = true;
    fallback.hidden = false;
  }
  if (state.text && (state.ts ?? 0) > lastTs) {
    lastTs = state.ts ?? Date.now();
    showBubble(state.text);
  }
}

stage.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  hideMenu();
  void invoke("pet_start_drag").catch(() => undefined);
});

window.addEventListener("mouseup", () => {
  if (menuOpen) return;
  void invoke("pet_save_position").catch(() => undefined);
});

stage.addEventListener("click", () => {
  if (menuOpen) return;
  showBubble(LINES[Math.floor(Math.random() * LINES.length)] ?? "在呢");
});

stage.addEventListener("dblclick", () => {
  hideMenu();
  void invoke("pet_open_main").catch(() => undefined);
});

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  menu.hidden = false;
  menuOpen = true;
  const x = Math.min(event.clientX, window.innerWidth - 130);
  const y = Math.min(event.clientY, window.innerHeight - 110);
  menu.style.left = `${Math.max(4, x)}px`;
  menu.style.top = `${Math.max(4, y)}px`;
});

menu.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest("button");
  const action = target?.dataset.action;
  hideMenu();
  if (action === "chat") void invoke("pet_open_main");
  else if (action === "hide") void invoke("pet_hide");
  else if (action === "close") void invoke("pet_close");
});

window.addEventListener("storage", (event) => {
  if (event.key === "pet.state") applyState();
});
window.setInterval(applyState, 1200);
window.addEventListener("blur", hideMenu);
applyState();
