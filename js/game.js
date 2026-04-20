/* ═══════════════════════════════════════════
   NIM BOARD GAME — OPTIMIZED GAME ENGINE v2
   ═══════════════════════════════════════════ */

(function () {
    'use strict';

    // ─── CONFIG ───
    const INITIAL_BALLS = [3, 5, 7];
    const ANIMATION_MS = 350;

    // ─── GAME STATE ───
    let state = createFreshState();

    function createFreshState() {
        return {
            rods: [...INITIAL_BALLS],
            moved: [0, 0, 0],
            currentPlayer: 1,
            selectedRod: null,
            selectedIndices: new Set(),   // indices of selected balls on selectedRod
            moveNumber: 1,
            gameOver: false,
            logicMode: false
        };
    }

    // ─── DOM CACHE (one-time lookups) ───
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        board: $('#game-board'),
        rodRows: $$('.rod-row'),
        sideA: [$('#rod0-sideA'), $('#rod1-sideA'), $('#rod2-sideA')],
        sideB: [$('#rod0-sideB'), $('#rod1-sideB'), $('#rod2-sideB')],
        badgeP1: $('#badge-p1'),
        badgeP2: $('#badge-p2'),
        moveCounter: $('#move-counter'),
        selectionInfo: $('#selection-info'),
        statusMessage: $('#status-message'),
        btnConfirm: $('#btn-confirm'),
        btnUndo: $('#btn-undo'),
        btnNewGame: $('#btn-new-game'),
        btnPlayAgain: $('#btn-play-again'),
        btnRules: $('#btn-rules'),
        btnCloseRules: $('#btn-close-rules'),
        rulesPanel: $('#rules-panel'),
        winModalEl: $('#winModal'),
        winModal: null,
        winTitle: $('#winModalLabel'),
        winTotalMoves: $('#win-total-moves'),
        confettiContainer: $('#confetti-container'),
        btnToggleLogic: $('#btn-toggle-logic'),
        logicHud: $('#logic-hud'),
        logicNimSum: $('#logic-nim-sum'),
        logicPosType: $('#logic-position-type'),
        logicHint: $('#logic-hint-text'),
    };

    // ─── INIT ───
    function init() {
        dom.winModal = new bootstrap.Modal(dom.winModalEl);
        buildBoardDOM();
        syncUI();
        bindEvents();
    }

    // ─── BUILD BOARD DOM (once at start / reset) ───
    function buildBoardDOM() {
        for (let r = 0; r < 3; r++) {
            buildRodDOM(r);
        }
    }

    function buildRodDOM(rodIndex) {
        const frag_a = document.createDocumentFragment();
        const frag_b = document.createDocumentFragment();

        // Side A balls
        for (let i = 0; i < state.rods[rodIndex]; i++) {
            frag_a.appendChild(makeBall(rodIndex, i, false));
        }

        // Side B balls
        for (let i = 0; i < state.moved[rodIndex]; i++) {
            frag_b.appendChild(makeBall(rodIndex, i, true));
        }

        // Single DOM write per side
        dom.sideA[rodIndex].innerHTML = '';
        dom.sideA[rodIndex].appendChild(frag_a);
        dom.sideB[rodIndex].innerHTML = '';
        dom.sideB[rodIndex].appendChild(frag_b);
    }

    function makeBall(rodIndex, index, isMoved) {
        const el = document.createElement('div');
        el.className = isMoved ? 'ball moved' : 'ball';
        el.dataset.rod = rodIndex;
        el.dataset.idx = index;
        if (!isMoved) {
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label',
                `Ball ${index + 1} on rod ${rodIndex + 1}. Click to select.`);
        }
        return el;
    }

    // ─── LIGHTWEIGHT UI SYNC (no DOM rebuild) ───
    function syncUI() {
        // Player badges
        dom.badgeP1.classList.toggle('active-player', state.currentPlayer === 1);
        dom.badgeP2.classList.toggle('active-player', state.currentPlayer === 2);

        // Move counter
        dom.moveCounter.textContent = `Move #${state.moveNumber}`;

        // Selection info
        const selCount = state.selectedIndices.size;
        if (selCount > 0) {
            show(dom.selectionInfo);
            show(dom.btnUndo);
            dom.selectionInfo.textContent =
                `${selCount} ball${selCount > 1 ? 's' : ''} from Rod ${state.selectedRod + 1}`;
        } else {
            hide(dom.selectionInfo);
            hide(dom.btnUndo);
        }

        // Confirm button
        dom.btnConfirm.disabled = selCount === 0 || state.gameOver;

        // Status message
        if (state.gameOver) {
            dom.statusMessage.textContent = 'Game Over!';
        } else if (selCount > 0) {
            dom.statusMessage.textContent =
                `Player ${state.currentPlayer}: Confirm move or adjust selection`;
        } else {
            dom.statusMessage.textContent =
                `Player ${state.currentPlayer}, select balls from a rod`;
        }

        // Ball & rod states
        syncBallClasses();
        syncRodHighlight();

        // New: Logic HUD sync
        updateLogicHUD();
    }

    function syncBallClasses() {
        for (let r = 0; r < 3; r++) {
            const balls = dom.sideA[r].children;
            const isLocked = (state.selectedRod !== null && state.selectedRod !== r) || state.gameOver;

            for (let i = 0; i < balls.length; i++) {
                const b = balls[i];
                b.classList.toggle('disabled', isLocked);
                b.classList.toggle('selected',
                    state.selectedRod === r && state.selectedIndices.has(i));
            }
        }
    }

    function syncRodHighlight() {
        dom.rodRows.forEach((row, i) => {
            row.classList.toggle('rod-active', state.selectedRod === i);
        });
    }

    // ─── BALL CLICK WITH RANGE SELECTION ───
    function onBallClick(ball) {
        if (state.gameOver) return;
        if (ball.classList.contains('moved') || ball.classList.contains('disabled')) return;

        const rodIndex = +ball.dataset.rod;
        const ballIndex = +ball.dataset.idx;

        // Lock rod on first selection
        if (state.selectedRod === null) {
            state.selectedRod = rodIndex;
        }
        if (rodIndex !== state.selectedRod) return;

        const sel = state.selectedIndices;

        if (sel.size === 0) {
            // First click: select this ball
            sel.add(ballIndex);
        } else if (sel.has(ballIndex)) {
            // Clicking already-selected ball: deselect it
            sel.delete(ballIndex);
            if (sel.size === 0) state.selectedRod = null;
        } else {
            // ★ RANGE SELECTION: fill between min-selected and clicked index
            const existing = [...sel];
            const lo = Math.min(ballIndex, Math.min(...existing));
            const hi = Math.max(ballIndex, Math.max(...existing));

            // NEW: Constraint — If last rod, cannot take all balls
            const otherRodsTotal = state.rods.reduce((a, b, idx) => idx === rodIndex ? a : a + b, 0);
            const takingAll = (hi - lo + 1) === state.rods[rodIndex] || (sel.size + 1 === state.rods[rodIndex]);
            
            if (otherRodsTotal === 0 && takingAll) {
                // Flash status or play error sound? For now, just return
                dom.statusMessage.textContent = "You must leave at least one ball!";
                dom.statusMessage.style.color = "var(--danger)";
                setTimeout(() => {
                    dom.statusMessage.style.color = "";
                    syncUI();
                }, 1000);
                return;
            }

            for (let i = lo; i <= hi; i++) {
                sel.add(i);
            }
        }

        syncUI();
    }

    // ─── SELECT ALL BALLS ON A ROD (double-click) ───
    function onBallDblClick(ball) {
        if (state.gameOver) return;
        if (ball.classList.contains('moved') || ball.classList.contains('disabled')) return;

        const rodIndex = +ball.dataset.rod;

        if (state.selectedRod === null) {
            state.selectedRod = rodIndex;
        }
        if (rodIndex !== state.selectedRod) return;

        // NEW: Constraint — If last rod, cannot take all balls
        const otherRodsTotal = state.rods.reduce((a, b, idx) => idx === rodIndex ? a : a + b, 0);
        if (otherRodsTotal === 0) {
            // Select all but one
            state.selectedIndices.clear();
            for (let i = 0; i < state.rods[rodIndex] - 1; i++) {
                state.selectedIndices.add(i);
            }
        } else {
            // Select ALL balls on this rod
            state.selectedIndices.clear();
            for (let i = 0; i < state.rods[rodIndex]; i++) {
                state.selectedIndices.add(i);
            }
        }

        syncUI();
    }

    // ─── CONFIRM MOVE ───
    function confirmMove() {
        const selCount = state.selectedIndices.size;
        if (selCount === 0 || state.selectedRod === null || state.gameOver) return;

        const rodIndex = state.selectedRod;

        // Animate the selected balls
        const balls = dom.sideA[rodIndex].children;
        const toAnimate = [];
        for (let i = 0; i < balls.length; i++) {
            if (state.selectedIndices.has(i)) {
                balls[i].classList.add('sliding');
                balls[i].classList.remove('selected');
                toAnimate.push(balls[i]);
            }
        }

        // Disable buttons during animation
        dom.btnConfirm.disabled = true;

        // After animation: update state + DOM
        setTimeout(() => {
            state.rods[rodIndex] -= selCount;
            state.moved[rodIndex] += selCount;

            const totalA = state.rods[0] + state.rods[1] + state.rods[2];

            if (totalA <= 1) {
                state.gameOver = true;
                buildRodDOM(rodIndex);
                syncUI();
                showWin(state.currentPlayer);
                return;
            }

            // Switch player + reset selection
            state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
            state.selectedRod = null;
            state.selectedIndices.clear();
            state.moveNumber++;

            buildRodDOM(rodIndex);
            syncUI();
        }, ANIMATION_MS);
    }

    // ─── UNDO SELECTION ───
    function undoSelection() {
        if (state.gameOver) return;
        state.selectedIndices.clear();
        state.selectedRod = null;
        syncUI();
    }

    // ─── WIN ───
    function showWin(player) {
        dom.winTitle.textContent = `Player ${player} Wins!`;
        dom.winTitle.style.color = player === 1 ? 'var(--p1-color)' : 'var(--p2-color)';
        dom.winTotalMoves.textContent = state.moveNumber;

        spawnConfetti();
        setTimeout(() => dom.winModal.show(), 200);
    }

    function spawnConfetti() {
        const c = dom.confettiContainer;
        c.innerHTML = '';
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#F59E0B', '#3B82F6', '#22C55E'];
        const frag = document.createDocumentFragment();

        for (let i = 0; i < 40; i++) {
            const p = document.createElement('div');
            p.className = 'confetti-piece';
            p.style.cssText = `
                left:${Math.random() * 100}%;
                background:${colors[i % colors.length]};
                animation-duration:${1.5 + Math.random() * 1.5}s;
                animation-delay:${Math.random() * 0.5}s;
                width:${5 + Math.random() * 5}px;
                height:${7 + Math.random() * 8}px;
                border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
            `;
            frag.appendChild(p);
        }
        c.appendChild(frag);
    }

    // ─── RESET ───
    function resetGame() {
        state = createFreshState();
        dom.confettiContainer.innerHTML = '';
        dom.winModal.hide();
        buildBoardDOM();
        syncUI();
    }

    // ─── RULES ───
    function toggleRules() {
        dom.rulesPanel.classList.toggle('hidden');
    }

    // ─── HELPERS ───
    function show(el) { el.classList.remove('hidden'); }
    function hide(el) { el.classList.add('hidden'); }

    // ─── EVENT BINDING (single delegation) ───
    function bindEvents() {
        // Single click — select / range-select
        dom.board.addEventListener('click', (e) => {
            const ball = e.target.closest('.ball');
            if (ball) onBallClick(ball);
        });

        // Double click — select all on rod
        dom.board.addEventListener('dblclick', (e) => {
            const ball = e.target.closest('.ball');
            if (ball) onBallDblClick(ball);
        });

        // Keyboard: Enter/Space on focused ball
        dom.board.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const ball = e.target.closest('.ball');
            if (!ball) return;
            e.preventDefault();
            onBallClick(ball);
        });

        dom.btnConfirm.addEventListener('click', confirmMove);
        dom.btnUndo.addEventListener('click', undoSelection);
        dom.btnNewGame.addEventListener('click', resetGame);
        dom.btnPlayAgain.addEventListener('click', resetGame);
        dom.btnRules.addEventListener('click', toggleRules);
        dom.btnCloseRules.addEventListener('click', toggleRules);

        // Close rules on outside click
        document.addEventListener('click', (e) => {
            if (!dom.rulesPanel.classList.contains('hidden') &&
                !dom.rulesPanel.contains(e.target) &&
                !dom.btnRules.contains(e.target)) {
                hide(dom.rulesPanel);
            }
        });

        // Keyboard shortcut: Enter to confirm when balls are selected
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.target.closest('.ball') &&
                state.selectedIndices.size > 0 && !state.gameOver) {
                e.preventDefault();
                confirmMove();
            }
            // Escape to undo
            if (e.key === 'Escape' && state.selectedIndices.size > 0) {
                undoSelection();
            }
        });

        dom.btnToggleLogic.addEventListener('click', toggleLogicMode);
    }

    // ─── LOGIC MODE ENGINE ───
    function toggleLogicMode() {
        state.logicMode = !state.logicMode;
        dom.btnToggleLogic.classList.toggle('active', state.logicMode);
        dom.logicHud.classList.toggle('hidden', !state.logicMode);
        syncUI();
    }

    function updateLogicHUD() {
        if (!state.logicMode || state.gameOver) return;

        const nimSum = state.rods[0] ^ state.rods[1] ^ state.rods[2];
        const rodsGreaterThanOne = state.rods.filter(r => r > 1).length;
        
        let isWinning = false;
        let move = null;

        // MISERE NIM STRATEGY (Leave 1 ball)
        if (rodsGreaterThanOne <= 1) {
            // Endgame: One or zero rods have more than 1 ball
            const onesCount = state.rods.filter(r => r === 1).length;
            const rodIdxWithMoreThanOne = state.rods.findIndex(r => r > 1);

            if (rodIdxWithMoreThanOne === -1) {
                // All rods are 0 or 1. Even number of 1s is a winning position in "Leave 1"
                // e.g. (1, 1) -> I take 1, leave 1, I win. (1, 1) is N-position.
                isWinning = (onesCount % 2 === 0 && onesCount > 0);
                if (isWinning) {
                    const firstOne = state.rods.findIndex(r => r === 1);
                    move = { rod: firstOne, count: 1 };
                }
            } else {
                // Exactly one rod > 1. We should leave an ODD number of 1s (total).
                // e.g. (5, 0, 0) -> Leave 1. (5, 1, 1) -> Leave 3.
                const targetOnes = (onesCount % 2 === 0) ? onesCount + 1 : onesCount;
                // Wait, if I leave 1 total ball, I win immediately.
                // So the goal is to leave 1 ball if possible.
                if (onesCount === 0) {
                   move = { rod: rodIdxWithMoreThanOne, count: state.rods[rodIdxWithMoreThanOne] - 1 };
                } else {
                   // If there are already some 1s, making the total 1 is impossible in one move
                   // so we follow Misere strategy to eventually win.
                   const targetSize = (onesCount % 2 === 0) ? 1 : 0;
                   move = { rod: rodIdxWithMoreThanOne, count: state.rods[rodIdxWithMoreThanOne] - targetSize };
                }
                isWinning = true;
            }
        } else {
            // Mid-game: Use Normal Nim sum
            isWinning = (nimSum !== 0);
            if (isWinning) {
                move = findNormalWinningMove(nimSum);
            }
        }

        dom.logicNimSum.textContent = nimSum;
        dom.logicPosType.textContent = isWinning ? 'Winning (N)' : 'Losing (P)';
        dom.logicPosType.style.color = isWinning ? 'var(--success)' : 'var(--danger)';

        if (isWinning && move) {
            dom.logicHint.textContent = `Strategic Move: Take ${move.count} from Rod ${move.rod + 1} to secure the win.`;
            dom.logicPosType.parentElement.classList.add('pulse');
        } else if (isWinning) {
            dom.logicHint.textContent = "You are in a winning position. Play carefully!";
            dom.logicPosType.parentElement.classList.add('pulse');
        } else {
            dom.logicHint.textContent = "Losing position (P). Opponent has the mathematical advantage.";
            dom.logicPosType.parentElement.classList.remove('pulse');
        }
    }

    function findNormalWinningMove(nimSum) {
        for (let i = 0; i < 3; i++) {
            const target = state.rods[i] ^ nimSum;
            if (target < state.rods[i]) {
                return { rod: i, count: state.rods[i] - target };
            }
        }
        return null;
    }

    // ─── BOOT ───
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
