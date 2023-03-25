import { Square, Tile, TileIdx } from './Square';
import { getRNG, setDiff } from './util';

export type MineNum = bigint | number;
type GameState = -1 | 0 | 1;
export type TileRet = [TileIdx, Tile];
type SpaceReveal = "flag" | "unflag" | "reveal";
// okay (in training), type of reveal, and tiles affected
type SpaceRet = [boolean, SpaceReveal, TileRet[]];
var defaultSpaceRet: SpaceRet = [true, "reveal", []];
var loseSpaceRet: SpaceRet = [false, "reveal", []];



export class Board {
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
