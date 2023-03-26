import { TileIdx } from "./Square";
import { StatusInterface } from "./StatusInterface";
import { SocketDao } from "./SocketDao";
import { WebGame } from "./WebGame";

export class WebSocketGame {
    private readonly doc: Document;

    private readonly webSocket: WebSocket;
    private readonly statusInterface: StatusInterface;
    private readonly socketDao: SocketDao;
    private webGame: WebGame;

    private playerNum: number | null;
    private startTimestamp: number | null;

    constructor(socketUrl: string, doc: Document) {
        this.doc = doc;

        this.webSocket = new WebSocket(socketUrl);
        this.statusInterface = new StatusInterface(doc);
        this.socketDao = new SocketDao(this.webSocket, this.statusInterface);
        
        this.webGame = WebGame.startNewGame(doc, this.socketDao);

        this.initSocket();

        this.playerNum = null;
        this.startTimestamp = null;
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
    
    private connectFn(data: any) {
        this.playerNum = data.playerNum;
        this.socketDao.addConnectionInfo(data.playerNum, data.opponentId, data.gameId);

        // this.connected = true;
        this.socketDao.canSendInit = true;
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
        this.socketDao.canSendInit = false;
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
        this.socketDao.canSendFinish = false;
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
        this.webGame.deleteBoard();
        this.webGame = WebGame.startNewGame(this.doc, this.socketDao);
        this.socketDao.reset();
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
