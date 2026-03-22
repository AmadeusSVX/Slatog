// D9: Text chat — 2D chat window UI
// State-based sync: sendMessage() mutates RoomState only; broadcast is handled by main.ts.
// reconcileUI calls appendMessage/removeMessage for incremental UI updates.

import { v4 as uuidv4 } from "uuid";
import type { RoomState } from "../../shared/room-state.js";
import type { ChatMessageEntry } from "../../shared/data-protocol.js";
import { USER_COLORS } from "../../shared/colors.js";

const MAX_TEXT_LENGTH = 280;

export type ChatEventHandler = (msg: ChatMessageEntry) => void;

export class ChatManager {
  private roomState: RoomState;
  private myPeerId: string;
  private myPeerName: string;
  private myColorIndex: number; // D15
  private panel: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private onNewMessage: ChatEventHandler | null = null;

  constructor(
    container: HTMLElement,
    roomState: RoomState,
    myPeerId: string,
    myPeerName: string,
    myColorIndex = 0,
  ) {
    this.roomState = roomState;
    this.myPeerId = myPeerId;
    this.myPeerName = myPeerName;
    this.myColorIndex = myColorIndex;

    this.panel = document.createElement("div");
    this.panel.id = "chat-panel";
    this.panel.innerHTML = `
      <div class="chat-header">Chat</div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input type="text" id="chat-input" placeholder="メッセージを入力..." maxlength="${MAX_TEXT_LENGTH}" />
      </div>
    `;
    container.appendChild(this.panel);

    this.messagesEl = this.panel.querySelector("#chat-messages")!;
    this.inputEl = this.panel.querySelector("#chat-input")!;

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.panel.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.panel.addEventListener("wheel", (e) => e.stopPropagation());
  }

  /** Set callback for new messages (used for 3D bubble display) */
  setOnNewMessage(handler: ChatEventHandler): void {
    this.onNewMessage = handler;
  }

  /** Add a single message to the UI (called from reconcileUI for remote messages) */
  appendMessage(msg: ChatMessageEntry): void {
    this.appendMessageToUI(msg);
    this.onNewMessage?.(msg);
  }

  /** Remove a message from the UI by id (called when enforceBudget removes it) */
  removeMessage(id: string): void {
    const el = this.messagesEl.querySelector(`[data-msg-id="${id}"]`);
    el?.remove();
  }

  /** Rebuild chat UI from current RoomState (for late joiner snapshot apply) */
  restoreHistory(): void {
    this.messagesEl.innerHTML = "";
    const messages = this.roomState.chatMessages.valuesByTime();
    for (const msg of messages) {
      this.appendMessageToUI(msg);
    }
  }

  dispose(): void {
    this.panel.remove();
  }

  // --- Private ---

  private sendMessage(): void {
    const text = this.inputEl.value.trim();
    if (!text) return;

    const entry: ChatMessageEntry = {
      id: uuidv4(),
      authorPeerId: this.myPeerId,
      authorName: this.myPeerName,
      colorIndex: this.myColorIndex, // D15
      text: text.slice(0, MAX_TEXT_LENGTH),
      timestamp: Date.now(),
    };

    // Mutate RoomState — onChange callback will trigger broadcast
    this.roomState.addChatMessage(entry);
    this.appendMessageToUI(entry);
    this.onNewMessage?.(entry);

    this.inputEl.value = "";
  }

  private appendMessageToUI(msg: ChatMessageEntry): void {
    const isMe = msg.authorPeerId === this.myPeerId;
    const div = document.createElement("div");
    div.className = `chat-msg${isMe ? " mine" : ""}`;
    div.setAttribute("data-msg-id", msg.id);

    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-msg-author";
    nameSpan.textContent = isMe ? "あなた" : msg.authorName;
    // D15: Use user color for author name
    const ci = msg.colorIndex ?? 0;
    nameSpan.style.color = USER_COLORS[ci];

    const textSpan = document.createElement("span");
    textSpan.className = "chat-msg-text";
    textSpan.textContent = msg.text;

    div.appendChild(nameSpan);
    div.appendChild(textSpan);
    this.messagesEl.appendChild(div);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
