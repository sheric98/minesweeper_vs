import json
import boto3
import time
from boto3.dynamodb.conditions import Attr, Key
from random import randint
import os


SESSION_TABLE_NAME = os.environ['SESSIONS_TABLE_NAME']
sessions = boto3.resource('dynamodb').Table(SESSION_TABLE_NAME)

lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['POST_LAMBDA_NAME']

ACTION_NAME = 'start'

MAX_U64 = (2 ** 64) - 1


def lambda_handler(event, context):
    player_one = event['player_one']
    player_two = event['player_two']
    game_id = event['game_id']
    
    start_timestamp = get_milli_start_timestamp()
    
    condition = (Key('sessionId').eq(game_id)) and (Attr('startTime').not_exists())
    try:
        key = {'sessionId': game_id}
        ret = sessions.update_item(
            Key=key,
            ReturnValues='ALL_OLD',
            UpdateExpression='SET startTime = :val',
            ExpressionAttributeValues={':val': start_timestamp},
            ConditionExpression=condition)
        attrs = ret['Attributes']
    except:
        return
    
    idxs = []
    if 'playerOneStartIdxs' in attrs:
        x_s, y_s = attrs['playerOneStartIdxs'].split(',')
        idxs.append([int(x_s), int(y_s)])
    if 'playerTwoStartIdxs' in attrs:
        x_s, y_s = attrs['playerTwoStartIdxs'].split(',')
        idxs.append([int(x_s), int(y_s)])
    
    seed = get_seed()
    send_start(idxs, start_timestamp, player_one, seed)
    send_start(idxs, start_timestamp, player_two, seed)


def send_start(idxs, start_timestamp, connection_id, seed):
    data = {'startIdxs': idxs, 'startTimestamp': start_timestamp, 'seed': seed}
    payload = {'connection_id': connection_id, 'action': ACTION_NAME, 'data': data}
    
    lambda_client.invoke(
        FunctionName=LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))


def get_milli_start_timestamp():
    return int((time.time() + 3) * 1000)


def get_seed():
    return str(randint(0, MAX_U64))
