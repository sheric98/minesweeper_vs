import { CfnOutput, Duration, Environment, Stack, StackProps } from "aws-cdk-lib";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { AttributeType, Table } from "aws-cdk-lib/aws-dynamodb";
import { WebSocketApi, WebSocketStage } from "@aws-cdk/aws-apigatewayv2-alpha";
import { IMatchmakingConfiguration, MatchmakingRuleSet, RuleSetContent, StandaloneMatchmakingConfiguration } from "@aws-cdk/aws-gamelift-alpha";
import { Construct } from "constructs";
import * as path from 'path';
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { WebSocketLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { StateMachine, StateMachineType, Wait, WaitTime } from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import 'string-format-ts';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync } from 'fs';
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, ISource, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Distribution, OriginAccessIdentity, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";

const LAMBDA_FOLDER: string = 'lib/lambda';
const WEBSITE_FOLDER: string = path.join('www', 'dist');
const DELAY_START_WAIT_TIME: Duration = Duration.seconds(5);
export const STAGE_NAME: string = 'production';

interface CreateLambdaProps {
    fileName: string,
    useConnectTable?: boolean,
    useSessionsTable?: boolean,
    usePostFunction?: boolean,
    useConnectPlayersFunction?: boolean,
    useSendStartFunction?: boolean,
    useRestartFunction?: boolean,
    additionalPolicies?: PolicyStatement[],
    additionalEnv?: {[key: string]: string}
}

export class MinesweeperVsBackendStack extends Stack {
    private readonly deploymentEnv: Environment;
    private readonly connectionsTable: Table;
    private readonly sessionsTable: Table;
    private readonly matchMakingConfig: IMatchmakingConfiguration;
    private readonly minesweeperApi: WebSocketApi;
    private readonly postFunction: Function;
    private readonly connectPlayersFunction: Function;
    private readonly sendStartFunction: Function;
    private readonly delayStartWorkflow: StateMachine;
    private readonly restartFunction: Function;
    private readonly websiteBucket: Bucket;

    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);
        this.deploymentEnv = props.env!;

        this.connectionsTable = new Table(this, 'MinesweeperConnectionsTable', {
            partitionKey: {name: 'connectionId', type: AttributeType.STRING}
        });

        this.sessionsTable = new Table(this, 'MinesweeperSessionsTable', {
            partitionKey: {name: 'sessionId', type: AttributeType.STRING}
        });

        this.matchMakingConfig = this.makeGameLiftConfiguration();

        const onConnectFunction = this.createOnConnectFunction();
        const onConnectIntegration = new WebSocketLambdaIntegration('OnConnectIntegration', onConnectFunction);

        const onDisconnectFunction = this.createOnDisconnectFunction();
        const onDisconnectIntegration = new WebSocketLambdaIntegration('OnDisconnectIntegration', onDisconnectFunction);

        this.minesweeperApi = new WebSocketApi(this, 'MinesweeperVsWebSocketApi', {
            connectRouteOptions: {
                integration: onConnectIntegration
            },
            disconnectRouteOptions: {
                integration: onDisconnectIntegration
            }
        });

        this.postFunction = this.createPostToConnectionFunction();

        this.connectPlayersFunction = this.createFunction('ConnectPlayers', {
            fileName: 'connectPlayers',
            useConnectTable: true,
            useSessionsTable: true,
            usePostFunction: true
        });

        const receiveMatchmakingNotificationLambda = this.createFunction('ReceiveMatchmakingNotification', {
            fileName: 'receiveMatchmakingNotification',
            useConnectPlayersFunction: true
        });
        receiveMatchmakingNotificationLambda.addEventSource(new SnsEventSource(this.matchMakingConfig.notificationTarget!));

        this.sendStartFunction = this.createFunction('MinesweeperVsSendStart', {
            fileName: 'sendStart',
            useSessionsTable: true,
            usePostFunction: true
        });

        this.delayStartWorkflow = this.createDelayStartWorkflow();
        
        const startKeyFunction: Function = this.createStartKeyFunction();

        this.delayStartWorkflow.grantStartExecution(startKeyFunction.role!);
        this.delayStartWorkflow.grantExecution(startKeyFunction.role!, 'states:StopExecution');

        const startKeyIntegration = new WebSocketLambdaIntegration('StartKeyIntegration', startKeyFunction);
        this.minesweeperApi.addRoute('startKey', {
            integration: startKeyIntegration,
            returnResponse: true
        });

        const finishFunction: Function = this.createFunction('MinesweeperVsFinish', {
            fileName: 'finish',
            useSessionsTable: true,
            usePostFunction: true,
        });
        const finishIntegration = new WebSocketLambdaIntegration('FinishIntegration', finishFunction);
        this.minesweeperApi.addRoute('finish', {
            integration: finishIntegration
        });

        this.restartFunction = this.createFunction('MinesweeperVsRestart', {
            fileName: 'restart',
            useSessionsTable: true,
            usePostFunction: true
        });

        const restartRequestFunction: Function = this.createFunction('MinesweeperVsRestartRequest', {
            fileName: 'restartRequest',
            useSessionsTable: true,
            usePostFunction: true,
            useRestartFunction: true
        });
        const restartRequestIntegration = new WebSocketLambdaIntegration('RestartRequestIntegration', restartRequestFunction);
        this.minesweeperApi.addRoute('restartRequest', {
            integration: restartRequestIntegration
        });

        const updateFunction: Function = this.createFunction('MinesweeperVsUpdate', {
            fileName: 'update',
            usePostFunction: true,
        });
        const updateIntegration = new WebSocketLambdaIntegration('UpdateIntegration', updateFunction);
        this.minesweeperApi.addRoute('update', {
            integration: updateIntegration
        });

        const WebSocketApiStage = new WebSocketStage(this, 'WebSocketStage', {
            webSocketApi: this.minesweeperApi,
            stageName: STAGE_NAME,
            autoDeploy: true
        });

        this.websiteBucket = new Bucket(this, 'WebsiteDeploymentBucket', {
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL
        });

        const deployWebsiteFiles = this.deployWebsiteToBucket();

        const originAccessIdentity = new OriginAccessIdentity(this, 'CloudfrontOrigin');
        this.websiteBucket.grantRead(originAccessIdentity);

        const distribution = new Distribution(this, 'CloudfrontDistribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new S3Origin(this.websiteBucket, {
                    originAccessIdentity: originAccessIdentity,
                }),
                viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY
            },
        });

        distribution.node.addDependency(deployWebsiteFiles);
    }

    private makeGameLiftConfiguration(): IMatchmakingConfiguration {
        const ruleSet = new MatchmakingRuleSet(this, 'MinesweeperVsRuleSet', {
            matchmakingRuleSetName: 'MinesweeperVsRuleSet',
            content: RuleSetContent.fromJsonFile(path.join(__dirname, 'matchMaking/matchMakingRuleSet.json'))
        });

        return new StandaloneMatchmakingConfiguration(this, 'MinesweeperVsConfiguration', {
            matchmakingConfigurationName: 'MinesweeperVsConfiguration',
            ruleSet: ruleSet
        });
    }

    private createOnConnectFunction(): Function {
        const matchMakingStart: PolicyStatement = new PolicyStatement({
            actions: ["gamelift:StartMatchmaking"],
            resources: ["*"],
            effect: Effect.ALLOW
        });

        return this.createFunction('MinesweeperVsOnConnect', {
            fileName: 'onConnect',
            useConnectTable: true,
            additionalEnv: {
                MINESWEEPER_CONFIG_NAME: this.matchMakingConfig.matchmakingConfigurationName
            },
            additionalPolicies: [matchMakingStart]
        });
    }

    private createOnDisconnectFunction(): Function {
        const matchMakingStop: PolicyStatement = new PolicyStatement({
            actions: ["gamelift:StopMatchmaking"],
            resources: ["*"],
            effect: Effect.ALLOW
        });

        return this.createFunction('MinesweeperVsOnDisconnect', {
            fileName: 'onDisconnect',
            useConnectTable: true,
            useSessionsTable: true,
            additionalPolicies: [matchMakingStop]
        });
    }

    private createPostToConnectionFunction(): Function {
        const apiGatewayPostAccess: PolicyStatement = new PolicyStatement({
            actions: ['execute-api:*'],
            resources: [this.getArnForExecuteApi()],
            effect: Effect.ALLOW
        });

        return this.createFunction('MinesweeperVsPostToConnection', {
            fileName: 'postToConnection',
            additionalPolicies: [apiGatewayPostAccess],
            additionalEnv: {
                SOCKET_ENDPOINT: this.getSocketEndpoint()
            }
        });
    }

    private createDelayStartWorkflow(): StateMachine {
        const delay = new Wait(this, 'DelayStartWait', {
            time: WaitTime.duration(DELAY_START_WAIT_TIME)
        });

        const invokeSendStart = new LambdaInvoke(this, 'InvokeSendStart', {
            lambdaFunction: this.sendStartFunction
        });

        delay.next(invokeSendStart);

        return new StateMachine(this, 'DelayStartWorkflow', {
            definition: delay,
            stateMachineType: StateMachineType.EXPRESS
        });
    }

    private createStartKeyFunction(): Function {
        return this.createFunction('MinesweeperVsStartKey', {
            fileName: 'startKey',
            useSessionsTable: true,
            useSendStartFunction: true,
            additionalEnv: {
                DELAY_WORKFLOW_ARN: this.delayStartWorkflow.stateMachineArn
            }
        });
    }

    private getSocketEndpoint(): string {
        return `https://${this.minesweeperApi.apiId}.execute-api.${this.deploymentEnv.region!}.amazonaws.com/${STAGE_NAME}`
    }

    private getWssSocketEndpoint(): string {
        return `${this.minesweeperApi.apiEndpoint}/${STAGE_NAME}`;
    }

    private getArnForExecuteApi(): string {
        return `arn:aws:execute-api:${this.deploymentEnv.region!}:${this.deploymentEnv.account!}:${this.minesweeperApi.apiId}/${STAGE_NAME}/POST/*`;
    }

    private createFunction(constructId: string, createLambdaProps: CreateLambdaProps): Function {
        const env: {[key: string]: string} = createLambdaProps.additionalEnv ?? {};
        const additionalPolicies: PolicyStatement[] = createLambdaProps.additionalPolicies ?? [];

        if (createLambdaProps.useConnectTable === true) {
            additionalPolicies.push(this.createDdbAccessPolicy(this.connectionsTable));
            env['CONNECTIONS_TABLE_NAME'] = this.connectionsTable.tableName;
        }
        if (createLambdaProps.useSessionsTable === true) {
            additionalPolicies.push(this.createDdbAccessPolicy(this.sessionsTable));
            env['SESSIONS_TABLE_NAME'] = this.sessionsTable.tableName;
        }
        if (createLambdaProps.usePostFunction === true) {
            additionalPolicies.push(this.createLambdaInvokePolicy(this.postFunction));
            env['POST_LAMBDA_NAME'] = this.postFunction.functionName;
        }
        if (createLambdaProps.useConnectPlayersFunction === true) {
            additionalPolicies.push(this.createLambdaInvokePolicy(this.connectPlayersFunction));
            env['CONNECT_PLAYERS_LAMBDA'] = this.connectPlayersFunction.functionName;
        }
        if (createLambdaProps.useSendStartFunction === true) {
            additionalPolicies.push(this.createLambdaInvokePolicy(this.sendStartFunction));
            env['SEND_START_LAMBDA'] = this.sendStartFunction.functionName;
        }
        if (createLambdaProps.useRestartFunction === true) {
            additionalPolicies.push(this.createLambdaInvokePolicy(this.restartFunction));
            env['RESTART_LAMBDA_NAME'] = this.restartFunction.functionName;
        }

        const retLambda: Function = new Function(this, constructId, {
            runtime: Runtime.PYTHON_3_9,
            code: Code.fromAsset(LAMBDA_FOLDER),
            handler: `${createLambdaProps.fileName}.lambda_handler`,
            environment: env
        });

        additionalPolicies.forEach((policy: PolicyStatement) => {
            retLambda.addToRolePolicy(policy);
        });

        return retLambda;
    }

    private createDdbAccessPolicy(table: Table): PolicyStatement {
        return new PolicyStatement({
            actions: ["dynamodb:*"],
            effect: Effect.ALLOW,
            resources: [table.tableArn]
        });
    }

    private createLambdaInvokePolicy(func: Function): PolicyStatement {
        return new PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            effect: Effect.ALLOW,
            resources: [func.functionArn]
        });
    }

    private deployWebsiteToBucket(): BucketDeployment {
        const fileToData: Map<string, string> = new Map<string, string>();

        const fullWebsitePath: string = path.join(__dirname, WEBSITE_FOLDER);
        const tmpWebsitePath: string = path.join(__dirname, 'www', 'tmp');

        if (existsSync(tmpWebsitePath)) {
            rmSync(tmpWebsitePath, {recursive: true, force: true});
        }
        mkdirSync(tmpWebsitePath);
        const files = readdirSync(fullWebsitePath);
        let numDirectWrites: number = 0;
        files.forEach((file: string) => {
            let directWrite: boolean = true;
            const fullFilePath = path.join(fullWebsitePath, file);

            if (path.extname(file) == '.js') {
                const fileString: string = readFileSync(fullFilePath, 'utf-8');
                if (fileString.includes("{0}")) {
                    directWrite = false;
                    const dataString: string = fileString.format(this.getWssSocketEndpoint());
                    fileToData.set(file, dataString);
                }
            }

            if (directWrite) {
                numDirectWrites++;
                cpSync(fullFilePath, path.join(tmpWebsitePath, file), {recursive: true});
            }
        });

        const deploymentSources: ISource[] = [];
        if (numDirectWrites > 0) {
            deploymentSources.push(Source.asset(tmpWebsitePath));
        }
        fileToData.forEach((dataString: string, fileName: string) => {
            deploymentSources.push(Source.data(fileName, dataString));
        });

        return new BucketDeployment(this, 'DeployWebsiteFiles', {
            destinationBucket: this.websiteBucket,
            sources: deploymentSources
        });
    }
}
