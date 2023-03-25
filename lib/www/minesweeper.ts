const WIDTH = 30;
const HEIGHT = 16;
const NUM_MINES = 99;
const NUM_TILES = WIDTH * HEIGHT;
const NUM_SAFE = NUM_TILES - NUM_MINES;

const UPDATE_QUEUE_TIME = 1000;

type TileNum = number
type Tile = "mine" | "empty" | TileNum
type State = "hidden" | "flagged" | "displayed"
type MineNum = bigint | number
type GameState = -1 | 0 | 1

// HASHING AND SEEDING

function cyrb128(str: string): [number, number, number, number] {
    let h1 = 1779033703, h2 = 3144134277,
        h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
    return function() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; 
      var t = (a + b) | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      d = d + 1 | 0;
      t = t + d | 0;
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    }
}

function getRNG(seed: string): () => number {
    let hash = cyrb128(seed);
    return sfc32(hash[0], hash[1], hash[2], hash[3]);
}


class Square {
    state: State;
    tile: Tile;
    hidden: Set<Square>;
    flagged: Set<Square>;
    neighs: Set<Square>;
    idx: TileIdx;

    constructor(tileIdx: TileIdx, tile: Tile) {
        this.state = "hidden";
        this.tile = tile;
        this.hidden = new Set();
        this.flagged = new Set();
        this.neighs = new Set();
        this.idx = tileIdx;
    }

    reveal() {
        this.state = "displayed";
        for (let neigh of this.neighs) {
            neigh.remove_hidden(this);
        }
    }

    // returns if the flag is correct or not. For used in training mode
    flag(): boolean {
        this.state = "flagged";
        for (let neigh of this.neighs) {
            neigh.add_flag(this);
        }
        return this.tile === "mine";
    }

    unflag() {
        this.state = "hidden";
        for (let neigh of this.neighs) {
            neigh.remove_flag(this);
        }
    }

    add_hiddens(hiddens: Square[]) {
        for (let hid of hiddens) {
            this.hidden.add(hid);
            this.neighs.add(hid);
        }
    }

    remove_hidden(hidden: Square) {
        this.hidden.delete(hidden);
    }

    add_flag(flag_sq: Square) {
        this.hidden.delete(flag_sq);
        this.flagged.add(flag_sq);
    }

    remove_flag(flag_sq: Square) {
        this.flagged.delete(flag_sq);
        this.hidden.add(flag_sq);
    }

    get_num(): null | number {
        if (this.tile === "mine") {
            return null;
        }
        else if (this.tile === "empty") {
            return 0;
        }
        else {
            return this.tile;
        }
    }
}

type TileIdx = [number, number]
type TileRet = [TileIdx, Tile]
type SpaceReveal = "flag" | "unflag" | "reveal"
// okay (in training), type of reveal, and tiles affected
type SpaceRet = [boolean, SpaceReveal, TileRet[]]
var defaultSpaceRet: SpaceRet = [true, "reveal", []]
var loseSpaceRet: SpaceRet = [false, "reveal", []]

function setDiff<T>(A: Set<T>, B: Set<T>): Set<T> {
    let ret: Set<T> = new Set();

    for (let a of A) {
        if (!B.has(a)) {
            ret.add(a);
        }
    }

    return ret;
}


class Board {
    width: bigint;
    height: bigint;
    totMines: bigint;
    squares: Array<Array<Square>>;
    mines: Set<Square>;
    flags: Set<Square>;
    unclearedSquares: bigint;
    gameState: GameState;
    training: boolean;
    gameId: number[];

    static NEIGHS: TileIdx[] = [
        [1, 1], [1, 0], [1, -1],
        [0, 1], [0, -1],
        [-1, 1], [-1, 0], [-1, -1]
    ];

    static getNumMines(width: bigint, height: bigint, mines: MineNum): bigint {
        if (typeof mines === "bigint") {
            let minesCapped = Math.max(0,
                Math.min(Number(height * width), Number(mines)));
            return BigInt(minesCapped);
        }
        else {
            let pct = Math.max(0, Math.min(1, mines));
            return BigInt(
                Math.round(Number(width) * Number(height) * pct));
        }
    }

    constructor(
        width: bigint,
        height: bigint,
        startingIdxs: TileIdx[],
        mines: MineNum = 99n,
        training: boolean,
        seed: string,
    ) {
        this.width = width;
        this.height = height;
        this.totMines = Board.getNumMines(width, height, mines);
        this.training = training;
        this.unclearedSquares = (height * width) - this.totMines;

        let initPair = this.initSquares(startingIdxs, seed);
        this.squares = initPair[0];
        this.mines = initPair[1];
        this.flags = new Set();
        this.gameState = 0;

        let idSize = Math.ceil(Number(this.height * this.width) / 53);
        this.gameId = Array(idSize).fill(0)
    }

    getSquare(tileIdx: TileIdx): Square {
        let x = tileIdx[0], y = tileIdx[1];
        return this.squares[y][x];
    }

    static convert1d2d(idx: number, width: bigint): TileIdx {
        let x = idx % Number(width);
        let y = Math.floor(idx / Number(width));
        return [x, y];
    }

    static convert2d1d(tileIdx: TileIdx, width: bigint): number {
        let x = tileIdx[0], y = tileIdx[1];
        return y * Number(width) + x;
    }

    static getNeighbors(tileIdx: TileIdx, width: bigint, height: bigint): TileIdx[] {
        let x = tileIdx[0], y = tileIdx[1];
        let ret = Board.NEIGHS.map((pair) => {
            let neigh: TileIdx = [pair[0] + x, pair[1] + y];
            return neigh
        }).filter(pair => pair[0] >= 0 && pair[0] < width
            && pair[1] >= 0 && pair[1] < height);

        return ret;
    }

    countAdjacent(tileIdx: TileIdx, mineSquares: Set<number>)
        : Tile {
        let neighs = Board.getNeighbors(tileIdx, this.width, this.height)
            .filter(x => mineSquares.has(Board.convert2d1d(x, this.width)));
        if (neighs.length == 0) {
            return "empty";
        }
        else {
            return neighs.length;
        }
    }

    correctFlagged(tileIdx: TileIdx): boolean {
        var square = this.getSquare(tileIdx);
        if (square.tile === "mine" ||
            square.tile === "empty") {
            return false;
        }
        else {
            return square.flagged.size === square.tile;
        }
    }

    initSquares(startingIdxs: TileIdx[], seed: string): [Array<Array<Square>>, Set<Square>] {
        let nums = [...Array(Number(this.width * this.height)).keys()];
        function shuffle(array: any[]) {
            let rng = getRNG(seed);
            var currentIndex = array.length, temporaryValue, randomIndex;
          
            // While there remain elements to shuffle...
            while (0 !== currentIndex) {
          
              // Pick a remaining element...
              randomIndex = Math.floor(rng() * currentIndex);
              currentIndex -= 1;
          
              // And swap it with the current element.
              temporaryValue = array[currentIndex];
              array[currentIndex] = array[randomIndex];
              array[randomIndex] = temporaryValue;
            }
          
            return array;
        }
        let randomized: number[] = shuffle(nums);
        let safeSquares: Set<number> = new Set();

        startingIdxs.forEach((startingIdx: TileIdx) => {
            Board.getNeighbors(startingIdx, this.width, this.height)
                .map(idx => Board.convert2d1d(idx, this.width))
                .forEach((idx1d: number) => safeSquares.add(idx1d));
            safeSquares.add(Board.convert2d1d(startingIdx, this.width));
        });

        let potentialMines = randomized.filter(x => !safeSquares.has(x));

        var mineSquares = potentialMines.slice(0, Number(this.totMines))
            .map(idx => Board.convert1d2d(idx, this.width));

        var squares: Square[][] = new Array();
        for (let i=0; i < this.height; i++) {
            let empty: Square[] = new Array(Number(this.width));
            squares.push(empty);
        }

        var mines: Set<Square> = new Set();

        for (let tileIdx of mineSquares) {
            let x = tileIdx[0];
            let y = tileIdx[1];

            squares[y][x] = new Square(tileIdx, "mine");
            mines.add(squares[y][x]);
        }

        var mineSet = new Set(mineSquares.map(pair => Board.convert2d1d(pair, this.width)));

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j];
                if (mineSet.has(Board.convert2d1d(idx, this.width))) {
                    continue;
                }
                let numMines = this.countAdjacent(idx, mineSet);
                squares[j][i] = new Square(idx, numMines);
            }
        }

        for (let j = 0; j < this.height; j++) {
            for (let i = 0; i < this.width; i++) {
                let idx: TileIdx = [i, j]
                let neighs = Board.getNeighbors(idx, this.width, this.height)
                    .map(pair => squares[pair[1]][pair[0]]);
                squares[j][i].add_hiddens(neighs);
            }
        }

        return [squares, mines];
    }

    updateId(square: Square) {
        let flatIdx = Board.convert2d1d(square.idx, this.width);
        let arrIdx = Math.floor(flatIdx / 53);
        let internalIdx = flatIdx % 53;
        this.gameId[arrIdx] += (1 << internalIdx);
    }

    revealSquare(square: Square): TileRet[] {
        if (this.gameState !== 0 || square.state == "displayed") {
            return [];
        }
        square.reveal();
        this.updateId(square);
        var ret: TileRet[] = [[square.idx, square.tile]];
        if (square.tile === "mine") {
            this.gameState = -1;
            return ret;
        }
        if (square.tile === "empty") {
            for (let neigh of square.hidden) {
                let neighRet = this.revealSquare(neigh);
                ret = ret.concat(neighRet);
            }
        }

        if (--this.unclearedSquares === 0n) {
            this.gameState = 1;
        }
        return ret;
    }

    revealIdx(tileIdx: TileIdx): TileRet[] {
        let x = tileIdx[0], y = tileIdx[1];
        let tileRet = this.revealSquare(this.squares[y][x]);
        return tileRet; 
    }

    flagSquare(tileIdx: TileIdx): [boolean, TileIdx[]] {
        if (this.gameState !== 0) {
            return [true, []];
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "hidden") {
            let correctlyFlagged = square.flag();
            this.flags.add(square);
            if (!correctlyFlagged && this.training) {
                this.gameState = -1;
            }
            return [correctlyFlagged, [tileIdx]];
        }
        return [true, []];
    }

    unflagSquare(tileIdx: TileIdx): TileIdx[] {
        if (this.gameState !== 0) {
            return [];
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "flagged") {
            square.unflag();
            this.flags.delete(square);
            // no unflagging in training
            if (this.training) {
                this.gameState = -1;
            }
            return [tileIdx];
        }
        return [];
    }

    revealIdxs(tileIdxs: Iterable<TileIdx>): TileRet[] {
        let ret: TileRet[] = [];
        for (let tileIdx of tileIdxs) {
            ret = ret.concat(this.revealIdx(tileIdx));
        }

        return ret;
    }

    revealAround(tileIdx: TileIdx, flag: boolean): SpaceRet {
        if (this.gameState !== 0) {
            return defaultSpaceRet;
        }
        var square = this.getSquare(tileIdx);
        if (square.state === "hidden") {
            if (flag) {
                // though default to true (no lose), could lose to incorrect flag later in checking.
                return [true, "flag", []];
            }
            else {
                return defaultSpaceRet;
            }
        }
        else if (square.state === "flagged") {
            if (flag) {
                return [true, "unflag", []];
            }
            else {
                return defaultSpaceRet;
            }
        }
        else if (this.correctFlagged(tileIdx)) {
            let ret: TileRet[] = new Array();
            for (let neigh of square.hidden) {
                ret = ret.concat(this.revealSquare(neigh));
            }
            // in this case, clicked redundant square (with space). Lose in training.
            if (ret.length == 0 && this.training && flag) {
                this.gameState = -1;
                return loseSpaceRet;
            }
            else {
                // update model
                return [true, "reveal", ret];
            }
        }
        else {
            // in this case, we miss clicked. In training mode - we lose. Only lose on space rather than double click.
            if (this.training && flag) {
                this.gameState = -1;
                return loseSpaceRet;
            }
            else {
                return defaultSpaceRet;
            }
        }
    }

    // return pair of [incorrect flag, missing flag] squares
    getResults(): [Set<Square>, Set<Square>] {
        let incorrect = setDiff(this.flags, this.mines);
        let missing = setDiff(this.mines, this.flags);

        return [incorrect, missing];
    }

    gameIdEquals(checkId: number[]): boolean {
        return checkId.length === this.gameId.length && checkId.every((num, idx) => num == this.gameId[idx]);
    }
}

/* WebPage Interactions */
type Id = string
type Game = Board | null
type Hover = TileIdx | null
type Digit = "neg" | number
type Digits = [Digit, Digit, Digit, Digit]
type HTMLDigits = [HTMLElement, HTMLElement, HTMLElement, HTMLElement]

class WebGame {
    doc: Document;
    width: bigint;
    height: bigint;
    game: Game;
    hover: Hover;
    container: HTMLElement;
    face: HTMLElement;
    mines: MineNum;
    remainingMines: number;
    timeSpent: number;
    minesDigs: HTMLDigits;
    timerDigs: HTMLDigits;
    left: boolean;
    right: boolean;
    currHover: Set<number>;
    training: boolean;
    timerCallback: null | NodeJS.Timeout;
    startingTime: number;
    requestIdxs: Set<TileIdx>;
    usedHelp: boolean;
    canSendInit: boolean;
    socketDao: WebSocketGame;

    constructor(
        doc: Document,
        socketDao: WebSocketGame,
    ) {
        this.doc = doc;
        this.width = BigInt(WIDTH);
        this.height = BigInt(HEIGHT);
        this.mines = BigInt(NUM_MINES);
        this.training = this.getTrainingMode();
        this.game = null;
        this.hover = null;
        this.container = this.doc.getElementById("game")!;
        this.face = this.doc.getElementById("restart")!;
        this.minesDigs = [
            this.doc.getElementById("mines1")!,
            this.doc.getElementById("mines2")!,
            this.doc.getElementById("mines3")!,
            this.doc.getElementById("mines4")!,
        ]
        this.timerDigs = [
            this.doc.getElementById("timer1")!,
            this.doc.getElementById("timer2")!,
            this.doc.getElementById("timer3")!,
            this.doc.getElementById("timer4")!,
        ]

        this.updateFace();
        
        this.remainingMines = Number(Board.getNumMines(this.width, this.height, this.mines));
        this.timeSpent = 0;
        this.startingTime = -1;
        this.timerCallback = null;

        this.resetDigs(this.remainingMines, this.minesDigs);
        this.resetDigs(this.timeSpent, this.timerDigs);

        this.left = false;
        this.right = false;

        this.currHover = new Set();
        this.requestIdxs = new Set();

        this.usedHelp = false;
        this.canSendInit = false;

        this.socketDao = socketDao;

        this.initGameSpace();
    }

    private initGameSpace() {
        this.container.addEventListener('contextmenu', e => {
            e.preventDefault();
            return false;
        }, false);
        this.container.addEventListener('mouseleave', e => {
            this.hover = null;
        });
        this.doc.addEventListener('keydown', e => {
            if (e.code === 'Space') {
                e.preventDefault();
                if (this.hover !== null) {
                    this.spaceClick(this.hover, true);
                }
            }
        });
        this.doc.addEventListener('mousedown', e => {
            switch (e.button) {
                case 0:
                    this.left = true;
                    break;
                case 2:
                    this.right = true;
                    break;
            }
        });
        this.doc.addEventListener('mouseup', e => {
            switch (e.button) {
                case 0:
                    this.unHoverAll();
                    if (this.left && this.right) {
                        this.revealDoubleClick();
                    }
                    else if (this.canClick() && this.left) {
                        this.revealSingleClick();
                    }
                    this.left = false;
                    break;
                case 2:
                    this.unHoverAll();
                    if (this.left && this.right) {
                        this.revealDoubleClick();
                    }
                    this.right = false;
                    break;
            }
        });
    }

    private canClick(): boolean {
        return this.canSendInit || this.game !== null;
    }

    private revealSingleClick() {
        if (this.hover !== null) {
            if (this.game === null ||
                this.game.getSquare(this.hover).state === "hidden") {
                this.emptyClick(this.hover);
            }
        }
    }

    private getTrainingMode(): boolean {
        return false;
    }

    private revealDoubleClick() {
        this.currHover.clear();
        if (this.hover !== null) {
            this.spaceClick(this.hover, false);
        }
    }

    private hoverTile(tileIdx: TileIdx) {
        this.currHover.add(Board.convert2d1d(tileIdx, this.width));
        let tile = this.getTile(tileIdx);
        if (this.game === null ||
                this.game.getSquare(tileIdx).state === "hidden") {
            tile.classList.remove("hidden");
            tile.classList.add("hover");
        }
    }

    private unhoverTile(tileIdx: TileIdx, remove: boolean) {
        let tile = this.getTile(tileIdx);
        if (tile.classList.contains("hover")) {
            tile.classList.remove("hover");
            tile.classList.add("hidden");
        }
        if (remove) {
            this.currHover.delete(Board.convert2d1d(tileIdx, this.width));
        }
    }

    private unHoverAll() {
        for (let num of this.currHover) {
            let idx = Board.convert1d2d(num, this.width);
            this.unhoverTile(idx, false);
        }
        this.currHover.clear();
    }

    private hoverTiles(tileIdxs: TileIdx[]) {
        let hovers = new Set(
            tileIdxs.map(x => Board.convert2d1d(x, this.width)));
        
        let addHovers = setDiff(hovers, this.currHover);
        let unHovers = setDiff(this.currHover, hovers);

        for (let un of unHovers) {
            this.unhoverTile(Board.convert1d2d(un, this.width), true);
        }

        for (let add of addHovers) {
            this.hoverTile(Board.convert1d2d(add, this.width));
        }
    }

    private spaceClick(tileIdx: TileIdx, flag: boolean) {
        if (this.game !== null) {
            let [retOkay, retType, retArr] = this.game.revealAround(tileIdx, flag);
            if (retType === "flag") {
                this.flag(tileIdx);
            }
            else if (retType === "unflag") {
                this.unflag(tileIdx);
            }
            else {
                this.processTileRets(retArr);
                // check if we training lost or not
                if (retOkay) {
                    this.checkWin();
                }
            }
        }
    }

    public startGame(tileIdx1: TileIdx, tileIdx2: TileIdx | null, startingTime: number, seed: string) {
        let startingIdxs: TileIdx[] = [tileIdx1];
        if (tileIdx2 !== null) {
            startingIdxs.push(tileIdx2!);
        }
        this.game = new Board(this.width, this.height, startingIdxs, this.mines, this.training, seed);
        this.startingTime = startingTime;
        this.timerCallback = setTimeout(() => this.timer(), 1000);

        let retArr = this.game!.revealIdxs(startingIdxs);
        this.processTileRets(retArr);
        
        this.checkWin();
    }

    private emptyClick(tileIdx: TileIdx) {
        if (this.game === null) {
            this.socketDao.sendInitIdx(tileIdx[0], tileIdx[1]);
            // this.startGame(tileIdx);
        }
        else {
            let retArr = this.game!.revealIdx(tileIdx);
            this.processTileRets(retArr);
            
            this.checkWin();
        }
    }

    private processTileRets(tileRets: TileRet[]) {
        if (this.game!.gameState == -1) {
            if (tileRets != null && tileRets.length > 0) {
                let [loseIdx, _] = tileRets.find(pair => pair[1] === "mine")!;
                this.lose(loseIdx);
            }
            else {
                this.lose(null);
            }
        }
        else {
            if (tileRets != null && tileRets.length > 0) {
                tileRets.forEach(pair => {
                    this.revealPair(pair[0], pair[1]);
                    this.socketDao.queueUpdate(Board.convert2d1d(pair[0], this.game!.width));
                });
                this.socketDao.updateYourProgress(tileRets.length);
            }
        }
    }

    private checkFace() {
        if (this.game !== null && this.game.gameState !== 0) {
            this.updateFace();
        }
    }

    private checkWin() {
        if (this.game !== null && this.game.gameState === 1) {
            this.socketDao.sendFinish();
            let endTime = Date.now();
            // let timeTaken = (endTime - this.startingTime) / 1000;
            this.stopTimer();
            this.updateDigs(this.remainingMines, 0, this.minesDigs);
            this.revealWin();
        }
        this.checkFace();
    }

    private timer() {
        if (this.game === null || this.game.gameState !== 0) {
            return;
        } 
        let prevTime = this.timeSpent;
        this.timeSpent += 1;
        let nextUpdate = this.timeSpent + 1;
        this.updateDigs(prevTime, this.timeSpent, this.timerDigs);
        let milliToWait = this.startingTime + (nextUpdate * 1000) - Date.now();
        this.timerCallback = setTimeout(() => this.timer(), milliToWait);
    }

    public stopTimer() {
        if (this.timerCallback !== null) {
            clearTimeout(this.timerCallback);
            this.timerCallback = null;
            this.startingTime = -1;
            this.timeSpent = 0;
        }
    }

    private removeAttrs(tileIdx: TileIdx, tile: HTMLElement, reveal: boolean) {
        tile.onmousedown = e => {
            this.tileMouseDown(tileIdx, "displayed", e);
        };
        if (reveal) {
            this.revealTile(tile);
        }
    }

    private revealTile(tile: HTMLElement) {
        tile.classList.remove("hidden");
        tile.classList.add("revealed");
    }

    // true if lost, false else
    private revealPair(tileIdx: TileIdx, num: Tile): boolean {
        let tile = this.getTile(tileIdx);
        this.removeAttrs(tileIdx, tile, true);
        if (num === "mine") {
            this.lose(tileIdx);
            return true;
        }
        else if (num === "empty") {
            return false;
        }
        else {
            tile.classList.add("num_" + num.toString());
            return false;
        }
    }

    private lose(tileIdx: null | TileIdx) {
        this.stopTimer();

        if (tileIdx !== null) {
            let tile = this.getTile(tileIdx);
            tile.classList.add("lose");
            tile.classList.add("mine");
        }
        this.revealLose(tileIdx);
        this.checkFace();
    }

    private revealLose(tileIdx: null | TileIdx) {
        if (this.game === null) {
            return;
        }

        let [incorrect, missing] = this.game.getResults();
        if (tileIdx !== null) {
            let loseSquare = this.game.getSquare(tileIdx);
            missing.delete(loseSquare);
        }
        
        for (let inc of incorrect) {
            let tile = this.getTile(inc.idx);
            this.removeAttrs(inc.idx, tile, true);
            tile.classList.remove("flagged");
            tile.classList.add("no_mine");
        }

        for (let miss of missing) {
            let tile = this.getTile(miss.idx);
            this.removeAttrs(miss.idx, tile, true);
            tile.classList.add("mine");
        }
    }

    private revealWin() {
        if (this.game === null) {
            return;
        }

        let results = this.game.getResults();
        let missing = results[1];

        for (let miss of missing) {
            let tile = this.getTile(miss.idx);
            this.removeAttrs(miss.idx, tile, false);
            tile.classList.add("flagged");
        }
    }

    // true for safe, false for lost
    private flag(tileIdx: TileIdx) {
        if (this.game === null) {
            return;
        }
        else {
            let [correctlyFlagged, ret] = this.game.flagSquare(tileIdx);
            for (let pair of ret) {
                let tile = this.getTile(pair);
                tile.onmousedown = e => {
                    this.tileMouseDown(tileIdx, "flagged", e);
                };
                tile.classList.add("flagged");

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines -= 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
            }

            // check if we lost in training mode
            if (!correctlyFlagged && this.training) {
                this.lose(null);
            }
        }
    }

    private unflag(tileIdx: TileIdx) {
        if (this.game === null) {
            return;
        }
        else {
            let ret = this.game.unflagSquare(tileIdx);
            for (let pair of ret) {
                let tile = this.getTile(pair);
                tile.onmousedown = e => {
                    this.tileMouseDown(tileIdx, "hidden", e);
                };
                tile.classList.remove("flagged");

                // update mine count
                let prevNum = this.remainingMines
                this.remainingMines += 1;
                this.updateDigs(prevNum, this.remainingMines, this.minesDigs);
            }
            if (this.training && ret.length > 0) {
                this.lose(null);
            }
        }
    }

    private genId(tileIdx: TileIdx): Id {
        let x = tileIdx[0], y = tileIdx[1];
        return x.toString() + "_" + y.toString();
    }

    private getTile(tileIdx: TileIdx): HTMLElement {
        let id = this.genId(tileIdx);
        return this.doc.getElementById(id)!;
    }

    private defaultTileAttrs(tileIdx: TileIdx, tile: HTMLElement) {
        tile.classList.add("tile");
        tile.classList.add("hidden")
        tile.onmousedown = e => {
            this.tileMouseDown(tileIdx, "hidden", e);
        };
        tile.onmouseover = () => {
            this.hover = tileIdx;
            if (this.left && this.right) {
                this.hoverAround(tileIdx);
            }
            else if (this.left) {
                this.hoverSingle(tileIdx);
            }
        }
    }

    private tileMouseDown(tileIdx: TileIdx, state: State, e: MouseEvent) {
        switch (e.button) {
            case 0:
                if (this.right) {
                    this.hoverAround(tileIdx);
                }
                else {
                    this.hoverSingle(tileIdx);
                }
                break;
            case 2:
                if (this.left) {
                    this.hoverAround(tileIdx);
                }
                else {
                    switch (state) {
                        case "hidden":
                            this.flag(tileIdx);
                            break;
                        case "displayed":
                            break;
                        case "flagged":
                            this.unflag(tileIdx);
                    }
                }
        }
    }

    private hoverSingle(tileIdx: TileIdx) {
        this.hoverTiles([tileIdx]);
    }

    private hoverAround(tileIdx: TileIdx) {
        let neighs = Board.getNeighbors(tileIdx, this.width, this.height);
        neighs.push(tileIdx);
        this.hoverTiles(neighs);
    }

    private genTile(tileIdx: TileIdx) {
        let tile = this.doc.createElement('div');
        tile.id = this.genId(tileIdx);
        this.defaultTileAttrs(tileIdx, tile);
        return tile;
    }

    private genRow(j: number) {
        let row = this.doc.createElement('div');
        row.classList.add("row");
        for (let i = 0; i < this.width; i++) {
            let tileIdx: TileIdx = [i, j];
            let tile = this.genTile(tileIdx);
            row.appendChild(tile);
        }
        return row;
    }

    public genBoard() {
        var board = this.doc.getElementById("game")!;
        for (let j = 0; j < this.height; j++) {
            let row = this.genRow(j);
            board.appendChild(row);
        }
    }

    public deleteBoard() {
        this.requestIdxs.clear();
        this.stopTimer();
        var board = this.doc.getElementById("game")!;
        while (board.firstChild !== null) {
            board.removeChild(board.firstChild);
        }
    }

    private numToDigits(num: number): Digits {
        var dig1: Digit, dig2: Digit, dig3: Digit, dig4: Digit;
        let minNum = -999;
        let maxNum = 9999;

        if (num <= minNum) {
            dig1 = "neg";
            dig2 = 9;
            dig3 = 9;
            dig4 = 9;
        }
        else if (num >= maxNum) {
            dig1 = 9;
            dig2 = 9;
            dig3 = 9;
            dig4 = 9;
        }
        else {
            if (num < 0) {
                dig1 = "neg";
            }
            else {
                dig1 = Math.floor(num / 1000) % 10;
            }
            let pos = Math.abs(num);
    
            dig2 = Math.floor(pos / 100) % 10;
            dig3 = Math.floor(pos / 10) % 10;
            dig4 = pos % 10;
        }
        
        return [dig1, dig2, dig3, dig4];
    }

    private getDigClassName(dig: Digit): string {
        var postPend: string;
        if (dig === "neg") {
            postPend = dig;
        }
        else {
            postPend = dig.toString();
        }
        return "dig_" + postPend;
    }

    private getDiffDigs(digs1: Digits, digs2: Digits): [boolean, boolean, boolean, boolean] {
        return [
            digs1[0] !== digs2[0],
            digs1[1] !== digs2[1],
            digs1[2] !== digs2[2],
            digs1[3] !== digs2[3],
        ]
    }

    private updateDigs(prevNum: number, newNum: number, digs: HTMLDigits) {
        let prevDigs = this.numToDigits(prevNum);
        let newDigs = this.numToDigits(newNum);

        let diffs = this.getDiffDigs(prevDigs, newDigs);
        for (let i = 0; i < diffs.length; i++) {
            if (diffs[i]) {
                digs[i].classList.remove(this.getDigClassName(prevDigs[i]));
                digs[i].classList.add(this.getDigClassName(newDigs[i]));
            }
        }
    }

    private updateFace() {
        if (this.game === null || this.game.gameState === 0) {
            this.face.className = "normal";
        }
        else if (this.game.gameState === 1) {
            this.face.className = "happy";
        }
        else {
            this.face.className = "sad";
        }
    }

    private resetDigs(num: number, htmlDigs: HTMLDigits) {
        let digs = this.numToDigits(num);

        for (let i = 0; i < htmlDigs.length; i++) {
            htmlDigs[i].className = 'digit';
            htmlDigs[i].classList.add(this.getDigClassName(digs[i]));
        }
    }

    public static startNewGame(doc: Document, webSocketGame: WebSocketGame): WebGame {
        let ret = new WebGame(doc, webSocketGame);
        ret.genBoard();

        return ret;
    }
}

// Direct interaction

const SOCKET_URL = "{0}";

var webGame: null | WebGame = null;
var webSocketGame: null | WebSocketGame = null;
window.onload = () => {

    // add button onclicks
    document.getElementById('restart')!.onclick = create;

    webSocketGame = new WebSocketGame(SOCKET_URL, document);
};

function create() {
    // if (webGame !== null) {
    //     webGame.deleteBoard();
    // }
    // webGame = new WebGame(document);
    // webGame.genBoard();
}

// FROM MINESWEEPER VS ORIG

class StatusInterface {
    private readonly doc: Document;

    private statusBar: HTMLElement;
    private restartMessageBar: HTMLElement;
    private restartButton: HTMLButtonElement | null;
    private restartStatusBar: HTMLElement;
    private yourProgress: HTMLElement;
    private opponentProgress: HTMLElement;

    private numRevealed: number;
    private opponentRevealed: number;

    public canRestart: boolean;
    private restartFn: () => void;

    constructor(doc: Document, restartFn: () => void) {
        this.doc = doc;

        this.statusBar = doc.getElementById("status")!;
        this.restartMessageBar = doc.getElementById("restartMessage")!;
        this.restartButton = null;
        this.restartStatusBar = doc.getElementById("restartStatus")!;
        this.yourProgress = doc.getElementById("yourProgress")!;
        this.opponentProgress = doc.getElementById("opponentProgress")!;

        this.restartFn = restartFn;

        this.reset();
    }

    reset() {
        this.canRestart = false;
        this.numRevealed = 0;
        this.opponentRevealed = 0;
        this.setYourProgressPercentage();
        this.setOpponentProgressPercentage();
    }

    private addRestartButton() {
        this.restartButton = document.createElement('button');
        this.restartButton.innerText = 'Request Restart';
        this.restartButton.onclick = this.restartFn;
        this.restartStatusBar.appendChild(this.restartButton);
    }

    public removeRestartButton() {
        if (this.restartButton !== null) {
            this.restartButton.remove();
            this.restartButton = null;
        }
    }

    public makeRestartable() {
        this.canRestart = true;
        this.addRestartButton();
    }

    public setStatusMessage(msg: string) {
        this.statusBar.innerText = msg;
    }

    public setRestartStatusMessage(msg: string) {
        this.restartMessageBar.innerText = msg;
    }

    private calculatePercentage(revealNum: number) {
        return Math.floor((revealNum / NUM_SAFE) * 100);
    }

    private setYourProgressPercentage() {
        let percentage = this.calculatePercentage(this.numRevealed);
        this.yourProgress.innerText = `${percentage}%`;
    }

    private setOpponentProgressPercentage() {
        let percentage = this.calculatePercentage(this.opponentRevealed);
        this.opponentProgress.innerText = `${percentage}%`;
    }

    public updateYourProgress(numNewReveals: number) {
        this.numRevealed += numNewReveals;
        this.setYourProgressPercentage();
    }
    
    public updateOpponentProgress(numNewReveals: number) {
        this.opponentRevealed += numNewReveals;
        this.setOpponentProgressPercentage();
    }
}

class WebSocketGame {
    private readonly doc: Document;

    private readonly webSocket: WebSocket;
    private readonly statusInterface: StatusInterface;
    private webGame: WebGame;

    private opponentId: string | null;
    private playerNum: number | null;
    private gameId: string | null;
    private startTimestamp: number | null;

    private canSendFinish: boolean;

    private readonly updateQueue: number[];
    private updateNum: number;

    constructor(socketUrl: string, doc: Document) {
        this.doc = doc;

        this.webSocket = new WebSocket(socketUrl);
        
        this.statusInterface = new StatusInterface(doc, this.sendRestart.bind(this));
        this.webGame = WebGame.startNewGame(doc, this);

        this.initSocket();

        this.opponentId = null;
        this.playerNum = null;
        this.gameId = null;
        this.startTimestamp = null;

        this.canSendFinish = true
        this.updateQueue = Array(NUM_TILES).fill(0);
        this.updateNum = 0;
    }

    private initSocket() {
        this.webSocket.onopen = _ => {
            this.statusInterface.setStatusMessage('Looking for game...');
        }

        this.webSocket.onmessage = e => {
            console.log(e);
            let eventData = JSON.parse(e.data);
            console.log(eventData);
            this.handleAction(eventData.action, eventData.data);
        }
    }
    
    private makeDefaultData() {
        return {
            'playerNum': this.playerNum,
            'opponentId': this.opponentId,
            'gameId': this.gameId,
        };
    };
    
    private makePayload(action: string, data: any) {
        return {
            'action': action,
            'message': JSON.stringify(data)
        };
    };
    
    private sendData(action: string, data: any) {
        let payload = this.makePayload(action, data);
        this.webSocket.send(JSON.stringify(payload));
    }
    
    public sendInitIdx(x: number, y: number) {
        if (!this.webGame.canSendInit) {
            return;
        }
        this.webGame.canSendInit = false;
        let data: any = this.makeDefaultData();
        data['idxs'] = `${x},${y}`;
    
        this.sendData('startKey', data);
        this.statusInterface.setStatusMessage('Sent start request');
    };
    
    public sendFinish() {
        if (!this.canSendFinish) {
            return;
        }
        this.canSendFinish = false;
    
        let data = this.makeDefaultData();
        this.sendData('finish', data);
    
        this.statusInterface.setStatusMessage('Sent finish request...');
    }
    
    public sendRestart() {
        if (!this.statusInterface.canRestart) {
            return;
        }
        this.statusInterface.canRestart = false;
        this.statusInterface.removeRestartButton();
        this.statusInterface.setRestartStatusMessage('Sending restart request...');
    
        this.sendData('restartRequest', this.makeDefaultData());
    }

    public updateYourProgress(numReveals: number) {
        this.statusInterface.updateYourProgress(numReveals);
    }

    public queueUpdate(idx: number) {
        let shouldQueue: boolean = this.updateNum == 0;

        this.updateQueue[this.updateNum] = idx;
        this.updateNum++;
        if (shouldQueue) {
            setTimeout(this.sendUpdates.bind(this), UPDATE_QUEUE_TIME);
        }
    }
    
    public sendUpdates() {
        let data: any = this.makeDefaultData();
        data['updates'] = this.updateQueue.slice(0, this.updateNum);
    
        this.sendData('update', data);
        this.updateNum = 0;
    }

    private connectFn(data: any) {
        this.gameId = data.gameId;
        this.opponentId = data.opponentId;
        this.playerNum = data.playerNum;
        // this.connected = true;
        this.webGame.canSendInit = true;
        this.statusInterface.setStatusMessage('Connected! Select any square...');
    };
    
    private initReveal(x: number, y: number, x2: number | null, y2: number | null, startTime: number, seed: string) {
        this.statusInterface.makeRestartable();
    
        let tileIdx2: TileIdx | null = null;
        if (x2 !== null && y2 !== null) {
            tileIdx2 = [x2, y2];
        }
        this.webGame.startGame([x, y], tileIdx2, startTime, seed);
    }
    
    private countDown(revealFn: (() => void)) {
        let now = Date.now();
        let millis = this.startTimestamp! - now;
    
        if (millis <= 0) {
            revealFn();
            this.statusInterface.setStatusMessage('Game starting!');
        }
        else {
            let displaySeconds = Math.ceil(millis / 1000);
            let eventTimestamp = this.startTimestamp! - ((displaySeconds - 1) * 1000);
            let millisDelay = Math.max(eventTimestamp - now, 0);
            setTimeout(() => this.countDown(revealFn), millisDelay);
            if (millisDelay > 800) {
                this.statusInterface.setStatusMessage(`Game starting in ${displaySeconds} ...`);
            }
        }
    }
    
    private startFn(data: any) {
        this.webGame.canSendInit = false;
        this.startTimestamp = data.startTimestamp;
        let startIdxs = data.startIdxs;
        let [x, y] = startIdxs[0];
        let x2: number | null = null;
        let y2: number | null = null;
        if (startIdxs.length == 2) {
            [x2, y2] = startIdxs[1];
        }
        const startInitReveal = () => this.initReveal(x, y, x2, y2, this.startTimestamp!, data.seed);
        this.countDown(startInitReveal);
    }
    
    private opponentUpdatesFn(data: any) {
        this.statusInterface.updateOpponentProgress(data.length);
    }
    
    private gameOverFn(data: any) {
        this.canSendFinish = false;
        let message;
        if (data.winnerNum === this.playerNum!) {
            message = 'You win!';
        }
        else {
            message = 'You lose!';
        }
        this.statusInterface.setStatusMessage(message);
    }
    
    private messageFn(data: any) {
        this.statusInterface.setStatusMessage(data);
    }
    
    private restartMessageFn = (data: any) => {
        this.statusInterface.setRestartStatusMessage(data);
    }
    
    private restartFn(_: any) {
        this.canSendFinish = true;
        this.webGame.deleteBoard();
        this.webGame = WebGame.startNewGame(this.doc, this);
        this.webGame.canSendInit = true;
        this.updateNum = 0;
        this.statusInterface.reset();
        this.statusInterface.setStatusMessage('Restarted! Select any square...');
        this.statusInterface.setRestartStatusMessage('');
    }
    
    private errorFn(data: any) {
        console.log(`Received error: ${data}`);
    }
    
    actionFns: {[key: string]: ((data: any) => void)} = {
        "connect": this.connectFn.bind(this),
        "start": this.startFn.bind(this),
        "opponentUpdates": this.opponentUpdatesFn.bind(this),
        "gameOver": this.gameOverFn.bind(this),
        "message": this.messageFn.bind(this),
        "restartMessage": this.restartMessageFn.bind(this),
        "restart": this.restartFn.bind(this),
        "error": this.errorFn.bind(this),
    };
    
    private handleAction(action: string, data: any) {
        if (this.actionFns.hasOwnProperty(action)) {
            this.actionFns[action](data);
        }
        else {
            console.log(action, data);
        }
    };
}
