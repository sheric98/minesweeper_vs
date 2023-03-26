import { NUM_SAFE } from "./constants";

export class StatusInterface {
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
    private restartFn: (() => void) | null;

    constructor(doc: Document) {
        this.doc = doc;

        this.statusBar = doc.getElementById("status")!;
        this.restartMessageBar = doc.getElementById("restartMessage")!;
        this.restartButton = null;
        this.restartStatusBar = doc.getElementById("restartStatus")!;
        this.yourProgress = doc.getElementById("yourProgress")!;
        this.opponentProgress = doc.getElementById("opponentProgress")!;

        this.restartFn = null;

        this.reset();
    }

    public addRestartFn(restartFn: () => void) {
        this.restartFn = restartFn;
    }

    public reset() {
        this.canRestart = false;
        this.numRevealed = 0;
        this.opponentRevealed = 0;
        this.setYourProgressPercentage();
        this.setOpponentProgressPercentage();
    }

    private addRestartButton() {
        this.restartButton = document.createElement('button');
        this.restartButton.innerText = 'Request Restart';
        this.restartButton.onclick = this.restartFn!;
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
