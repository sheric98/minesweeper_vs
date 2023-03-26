import { StatusInterface } from "./StatusInterface";
import { NUM_TILES } from "./constants";

const UPDATE_QUEUE_TIME = 1000;

export class SocketDao {
    public canSendInit: boolean;
    public canSendFinish: boolean;
    private updateNum: number;
    private readonly updateQueue: number[];

    private opponentId: string | null;
    private playerNum: number | null;
    private gameId: string | null;

    private readonly webSocket: WebSocket;
    private readonly statusInterface: StatusInterface;

    constructor(webSocket: WebSocket, statusInterface: StatusInterface) {
        this.canSendInit = false;
        this.canSendFinish = true;
        this.updateNum = 0;
        this.updateQueue = Array(NUM_TILES).fill(0);

        this.opponentId = null;
        this.playerNum = null;
        this.gameId = null;

        this.statusInterface = statusInterface;
        this.statusInterface.addRestartFn(this.sendRestart.bind(this));
        this.webSocket = webSocket;
    }

    public addConnectionInfo(playerNum: number, opponentId: string, gameId: string) {
        this.playerNum = playerNum;
        this.opponentId = opponentId;
        this.gameId = gameId;
    }

    public sendInitIdx(x: number, y: number) {
        if (!this.canSendInit) {
            return;
        }
        this.canSendInit = false;
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
        if (!this.statusInterface!.canRestart) {
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

    private makeDefaultData() {
        return {
            'playerNum': this.playerNum!,
            'opponentId': this.opponentId!,
            'gameId': this.gameId!,
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

    public reset() {
        this.canSendFinish = true;
        this.updateNum = 0;
        this.canSendInit = true;
    }
}