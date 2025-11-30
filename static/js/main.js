console.log("main.js loaded");

document.addEventListener("DOMContentLoaded", () => {
  // ===== キャンバス関連 =====
  const pixelCanvas = document.getElementById("pixel-canvas"); // 実際に描く
  const pixelCtx = pixelCanvas.getContext("2d");

  const gridCanvas = document.getElementById("grid-canvas");   // グリッド＋選択枠用
  const gridCtx = gridCanvas.getContext("2d");

  const GRID_SIZE = 32;                             // 32×32マス
  const CELL_SIZE = pixelCanvas.width / GRID_SIZE;  // 512 / 32 = 16px
  const BG_COLOR = "#ffffff";                       // 背景色（消しゴムの色）
  let currentColor = "#000000";                     // 現在の描画色

  // 画面上の状態を保持する 32×32 の配列
  const pixels = Array.from({ length: GRID_SIZE }, () =>
    Array(GRID_SIZE).fill(BG_COLOR)
  );

  // ===== ツールボタン =====
  const penBtn = document.getElementById("pen-tool");
  const eraserBtn = document.getElementById("eraser-tool");
  const rectBtn = document.getElementById("rect-tool");
  const saveBtn = document.getElementById("save-btn");
  const resetBtn = document.getElementById("reset-btn");
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");

  // "pen" | "eraser" | "rect"
  let currentTool = "pen";

  function setActiveTool(tool) {
    currentTool = tool;

    penBtn.classList.remove("tool-active");
    eraserBtn.classList.remove("tool-active");
    rectBtn.classList.remove("tool-active");

    if (tool === "pen") {
      penBtn.classList.add("tool-active");
    } else if (tool === "eraser") {
      eraserBtn.classList.add("tool-active");
    } else if (tool === "rect") {
      rectBtn.classList.add("tool-active");
    }

    console.log("currentTool:", currentTool);
  }

  setActiveTool("pen");

  penBtn.addEventListener("click", () => setActiveTool("pen"));
  eraserBtn.addEventListener("click", () => setActiveTool("eraser"));
  rectBtn.addEventListener("click", () => setActiveTool("rect"));

  // ===== 色スロット・色相環 =====
  const colorSlotsContainer = document.getElementById("color-slots");
  const COLOR_SLOT_COUNT = 8;
  const colorSlots = [];

  // スロットDOM生成
  for (let i = 0; i < COLOR_SLOT_COUNT; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-slot empty";
    btn.dataset.index = String(i);
    colorSlotsContainer.appendChild(btn);

    colorSlots.push({
      element: btn,
      color: null, // まだ登録されていない
    });
  }

  // iro.js カラーピッカー（色相環＋明度スライダー）
  const colorPicker = new iro.ColorPicker("#color-wheel-container", {
    width: 180,
    color: currentColor,
    layout: [
      { component: iro.ui.Wheel },
      { component: iro.ui.Slider, options: { sliderType: "value" } },
    ],
  });

  // 色相環で色が変わったときに currentColor を更新
  colorPicker.on("color:change", (color) => {
    currentColor = color.hexString;
  });

  // スロットクリック時の挙動
  colorSlots.forEach((slot) => {
    slot.element.addEventListener("click", () => {
      if (slot.color) {
        // すでに登録済み → その色を選択
        currentColor = slot.color;
        colorPicker.color.hexString = slot.color;

        colorSlots.forEach((s) => s.element.classList.remove("selected"));
        slot.element.classList.add("selected");
      } else {
        // 空スロット → 現在の色を登録
        slot.color = currentColor;
        slot.element.classList.remove("empty");
        slot.element.style.background = currentColor;
      }
    });
  });

  // ===== グリッド＋選択枠描画（gridCanvas にだけ描く） =====

  // selection は { x1, y1, x2, y2 }（グリッド座標）か null
  function drawGrid(selection = null) {
    gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

    // グリッド線
    gridCtx.strokeStyle = "#e0e0e0";
    gridCtx.lineWidth = 1;

    // 縦線
    for (let x = 0; x <= GRID_SIZE; x++) {
      const px = x * CELL_SIZE + 0.5; // 0.5 ずらして線をシャープに
      gridCtx.beginPath();
      gridCtx.moveTo(px, 0);
      gridCtx.lineTo(px, gridCanvas.height);
      gridCtx.stroke();
    }

    // 横線
    for (let y = 0; y <= GRID_SIZE; y++) {
      const py = y * CELL_SIZE + 0.5;
      gridCtx.beginPath();
      gridCtx.moveTo(0, py);
      gridCtx.lineTo(gridCanvas.width, py);
      gridCtx.stroke();
    }

    // 選択中の矩形プレビュー
    if (selection) {
      const { x1, y1, x2, y2 } = selection;

      const gx1 = Math.min(x1, x2);
      const gx2 = Math.max(x1, x2);
      const gy1 = Math.min(y1, y2);
      const gy2 = Math.max(y1, y2);

      const px = gx1 * CELL_SIZE + 0.5;
      const py = gy1 * CELL_SIZE + 0.5;
      const w = (gx2 - gx1 + 1) * CELL_SIZE - 1;
      const h = (gy2 - gy1 + 1) * CELL_SIZE - 1;

      gridCtx.save();
      gridCtx.strokeStyle = "#888888";
      gridCtx.lineWidth = 2;
      gridCtx.setLineDash([4, 2]); // 点線っぽく
      gridCtx.strokeRect(px, py, w, h);
      gridCtx.restore();
    }
  }

  // ===== ドット描画（pixelCanvas にだけ描く） =====
  function drawCell(gridX, gridY, color) {
    const x = gridX * CELL_SIZE;
    const y = gridY * CELL_SIZE;
    pixelCtx.fillStyle = color;
    pixelCtx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  }

  function clearPixels() {
    pixelCtx.fillStyle = BG_COLOR;
    pixelCtx.fillRect(0, 0, pixelCanvas.width, pixelCanvas.height);
  }

  clearPixels();
  drawGrid(); // 初期状態から常に表示

  // ===== 履歴（Undo/Redo用） =====

  // history: 2次元配列のスナップショットの配列
  const history = [];
  let historyIndex = -1;

  function clonePixels() {
    // pixels のディープコピーを返す
    return pixels.map((row) => row.slice());
  }

  function applySnapshot(snapshot) {
    // snapshot を pixels に適用して、キャンバス描画を更新
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        pixels[y][x] = snapshot[y][x];
        drawCell(x, y, pixels[y][x]);
      }
    }
    drawGrid(); // 選択枠なしのグリッドに戻す
  }

  function updateUndoRedoState() {
    if (undoBtn) {
      undoBtn.disabled = historyIndex <= 0;
    }
    if (redoBtn) {
      redoBtn.disabled = historyIndex >= history.length - 1;
    }
  }

  function saveHistory() {
    const snapshot = clonePixels();

    // Undoしたあとに新しい操作をした場合は「未来の履歴」を切り捨てる
    history.splice(historyIndex + 1);
    history.push(snapshot);
    historyIndex = history.length - 1;
    updateUndoRedoState();

    console.log("history size:", history.length, "index:", historyIndex);
  }

  // 初期状態を履歴に登録
  saveHistory();

  // Undo/Redoボタン
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      if (historyIndex <= 0) return;
      historyIndex -= 1;
      applySnapshot(history[historyIndex]);
      updateUndoRedoState();
    });
  }

  if (redoBtn) {
    redoBtn.addEventListener("click", () => {
      if (historyIndex >= history.length - 1) return;
      historyIndex += 1;
      applySnapshot(history[historyIndex]);
      updateUndoRedoState();
    });
  }

  // ===== 入力座標 → グリッド座標変換 =====
  function getGridPosition(clientX, clientY) {
    const rect = pixelCanvas.getBoundingClientRect();
    const scaleX = pixelCanvas.width / rect.width;
    const scaleY = pixelCanvas.height / rect.height;

    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const gridX = Math.floor(canvasX / CELL_SIZE);
    const gridY = Math.floor(canvasY / CELL_SIZE);

    if (gridX < 0 || gridX >= GRID_SIZE || gridY < 0 || gridY >= GRID_SIZE) {
      return null;
    }
    return { gridX, gridY };
  }

  function applyToolAt(clientX, clientY) {
    const pos = getGridPosition(clientX, clientY);
    if (!pos) return;

    const { gridX, gridY } = pos;
    const color = currentTool === "pen" ? currentColor : BG_COLOR;

    pixels[gridY][gridX] = color;
    drawCell(gridX, gridY, color);
  }

  // ===== 矩形塗りつぶし =====
  let selectionStart = null; // { gridX, gridY } or null
  let selectionEnd = null;

  function fillRectSelection(start, end) {
    if (!start || !end) return;

    const x1 = Math.min(start.gridX, end.gridX);
    const x2 = Math.max(start.gridX, end.gridX);
    const y1 = Math.min(start.gridY, end.gridY);
    const y2 = Math.max(start.gridY, end.gridY);

    const color = currentColor; // 矩形ツールは常に currentColor で塗る

    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        pixels[y][x] = color;
        drawCell(x, y, color);
      }
    }
  }

  // ===== ポインターイベント（マウス／タッチ両対応） =====
  let isDrawing = false;

  function startDrawing(e) {
    isDrawing = true;
    pixelCanvas.setPointerCapture(e.pointerId);

    if (currentTool === "pen" || currentTool === "eraser") {
      // 通常のドット描画
      applyToolAt(e.clientX, e.clientY);
    } else if (currentTool === "rect") {
      // 矩形選択の開始点
      const pos = getGridPosition(e.clientX, e.clientY);
      selectionStart = pos;
      selectionEnd = pos;

      if (selectionStart) {
        drawGrid({
          x1: selectionStart.gridX,
          y1: selectionStart.gridY,
          x2: selectionStart.gridX,
          y2: selectionStart.gridY,
        });
      }
    }
  }

  function moveDrawing(e) {
    if (!isDrawing) return;

    if (currentTool === "pen" || currentTool === "eraser") {
      applyToolAt(e.clientX, e.clientY);
    } else if (currentTool === "rect") {
      const pos = getGridPosition(e.clientX, e.clientY);
      if (pos) {
        selectionEnd = pos;

        // プレビュー描画（グリッド＋選択枠）
        drawGrid({
          x1: selectionStart.gridX,
          y1: selectionStart.gridY,
          x2: selectionEnd.gridX,
          y2: selectionEnd.gridY,
        });
      }
    }
  }

  function endDrawing(e) {
    if (!isDrawing) return;
    isDrawing = false;

    try {
      pixelCanvas.releasePointerCapture(e.pointerId);
    } catch {
      // すでに解放済みのとき用に握りつぶす
    }

    if (currentTool === "rect" && selectionStart && selectionEnd) {
      fillRectSelection(selectionStart, selectionEnd);
      saveHistory(); // 矩形塗りつぶしを履歴に保存
    } else if (currentTool === "pen" || currentTool === "eraser") {
      // ペン／消しゴムでの描画を1アクションとして履歴に保存
      saveHistory();
    }

    selectionStart = null;
    selectionEnd = null;

    // 最後にグリッドだけの状態に戻す
    drawGrid();
  }

  pixelCanvas.addEventListener("pointerdown", startDrawing);
  pixelCanvas.addEventListener("pointermove", moveDrawing);
  pixelCanvas.addEventListener("pointerup", endDrawing);
  pixelCanvas.addEventListener("pointercancel", endDrawing);

  // ===== リセット =====
  resetBtn.addEventListener("click", () => {
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        pixels[y][x] = BG_COLOR;
      }
    }
    clearPixels();
    drawGrid();
    saveHistory(); // リセットも1アクションとして履歴に登録
  });

  // ===== 保存（グリッドなし PNG） =====
  saveBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = "pixel-art.png";
    link.href = pixelCanvas.toDataURL("image/png"); // グリッドは別キャンバスなので乗らない
    link.click();
  });

  // 最初のUndo/Redoボタン状態
  updateUndoRedoState();
});
