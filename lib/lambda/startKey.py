import json
import boto3
from boto3.dynamodb.conditions import Key
import os

SESSIONS_TABLE_NAME = os.environ['SESSIONS_TABLE_NAME']
sessions = boto3.resource('dynamodb').Table(SESSIONS_TABLE_NAME)

lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['SEND_START_LAMBDA']

sfn = boto3.client('stepfunctions')
STATE_MACHINE_ARN = os.environ['DELAY_WORKFLOW_ARN']


def lambda_handler(event, context):
    body = json.loads(event['body'])
    message = json.loads(body['message'])
    connection_id = event['requestContext']['connectionId']
    idxs = message['idxs']
    game_id = message['gameId']
    
    if message['playerNum'] == 0:
        player_one = connection_id
        player_two = message['opponentId']
        idx_attr = 'playerOneStartIdxs'
        other_attr = 'playerTwoStartIdxs'
    else:
        player_one = message['opponentId']
        player_two = connection_id
        idx_attr = 'playerTwoStartIdxs'
        other_attr = 'playerOneStartIdxs'
        
    sessions_key = {'sessionId': game_id}
    item_exists_condition = Key('sessionId').eq(game_id)
    
    ret = sessions.update_item(
        Key=sessions_key,
        ReturnValues='ALL_NEW',
        UpdateExpression=f'SET {idx_attr} = :val',
        ExpressionAttributeValues={':val': idxs},
        ConditionExpression=item_exists_condition)
        
    attrs = ret['Attributes']
    
    payload = get_payload(player_one, player_two, game_id)
    if other_attr in attrs:
            
        lambda_client.invoke(
            FunctionName=LAMBDA_NAME,
            InvocationType='Event',
            Payload=json.dumps(payload).encode('utf-8')
        )
        response_message = 'Game loading...'
    else:
        sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(payload))

        response_message = 'Waiting for other player...'
        
    return {
        "statusCode": 200,
        "body": json.dumps({'action': 'message', 'data': response_message})
    }

def stop_sfn(execution_id):
    sfn.stop_execution(executionArn=execution_id)
        

def get_payload(player_one, player_two, game_id):
    return {
        'player_one': player_one,
        'player_two': player_two,
        'game_id': game_id
    }
