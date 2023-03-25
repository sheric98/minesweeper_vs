type TileNum = number;
export type Tile = "mine" | "empty" | TileNum;
export type State = "hidden" | "flagged" | "displayed";
export type TileIdx = [number, number]

export class Square {
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
