import json
import boto3
from boto3.dynamodb.conditions import Key
import os


SESSION_TABLE_NAME = os.environ['SESSIONS_TABLE_NAME']
sessions = boto3.resource('dynamodb').Table(SESSION_TABLE_NAME)

lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['POST_LAMBDA_NAME']

ACTION_NAME = 'restart'

NEW_GAME_KEYS = ['sessionId', 'playerOne', 'playerTwo', 'numPlayers']

def lambda_handler(event, context):
    game_id = event['gameId']
    
    key = {'sessionId': game_id}
    get_ret = sessions.get_item(Key=key)
    item = get_ret['Item']
    
    condition = Key('sessionId').eq(game_id)
    new_item = {k:item[k] for k in NEW_GAME_KEYS}
    sessions.put_item(
        Item=new_item,
        ConditionExpression=condition)
    
    send_restart(new_item['playerOne'])
    send_restart(new_item['playerTwo'])
    

def send_restart(connection_id):
    payload = {'connection_id': connection_id, 'action': ACTION_NAME, 'data': ''}
    lambda_client.invoke(
        FunctionName=LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
