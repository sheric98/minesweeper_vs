import json
import boto3
from boto3.dynamodb.conditions import Attr, Key
import os

SESSIONS_TABLE_NAME = os.environ['SESSIONS_TABLE_NAME']
sessions = boto3.resource('dynamodb').Table(SESSIONS_TABLE_NAME)

lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['POST_LAMBDA_NAME']

FINISH_KEY = 'winner'
ACTION_NAME = 'gameOver'

def lambda_handler(event, context):
    body = json.loads(event['body'])
    message = json.loads(body['message'])
    connection_id = event['requestContext']['connectionId']

    game_id = message['gameId']
    opponent_id = message['opponentId']
    player_num = message['playerNum']
    
    condition = (Key('sessionId').eq(game_id)) and (Attr(FINISH_KEY).not_exists())
    
    try:
        key = {'sessionId': game_id}
        ret = sessions.update_item(
            Key=key,
            UpdateExpression=f'SET {FINISH_KEY} = :val',
            ExpressionAttributeValues={':val': player_num},
            ConditionExpression=condition)
    except:
        return {
            "statusCode": 200,
            "body": json.dumps('Other player won')
        }
        
    send_finish(player_num, connection_id)
    send_finish(player_num, opponent_id)
    
    return {
        "statusCode": 200,
        "body": json.dumps('You win!')
    }
    
    
def send_finish(player_num, connection_id):
    data = {'winnerNum': player_num}
    payload = {'connection_id': connection_id, 'action': ACTION_NAME, 'data': data}
    
    lambda_client.invoke(
        FunctionName=LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
    