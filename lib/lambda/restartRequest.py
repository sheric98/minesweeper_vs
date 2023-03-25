import json
import boto3
from boto3.dynamodb.conditions import Key
import os


SESSIONS_TABLE_NAME = os.environ['SESSIONS_TABLE_NAME']
sessions = boto3.resource('dynamodb').Table(SESSIONS_TABLE_NAME)

lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['POST_LAMBDA_NAME']
RETRY_LAMBDA_NAME = os.environ['RESTART_LAMBDA_NAME']

ACTION_NAME = 'restartMessage'


def lambda_handler(event, context):
    body = json.loads(event['body'])
    message = json.loads(body['message'])
    connection_id = event['requestContext']['connectionId']
    game_id = message['gameId']
    opponent_id = message['opponentId']
    
    try:
        key = {'sessionId': game_id}
        ret = sessions.update_item(
            Key=key,
            ReturnValues='UPDATED_NEW',
            UpdateExpression='ADD numRestartRequests :val',
            ExpressionAttributeValues={':val': 1},
            ConditionExpression=Key('sessionId').eq(game_id))
    except:
        return {
            'statusCode': 500,
            'body': json.dumps({'action': 'error', 'data': 'Game does not exist'})
        }
        
    attrs = ret['Attributes']
    num_retry_requests = attrs['numRestartRequests']
    
    if num_retry_requests == 1:
        send_retry_message(opponent_id, 'Opponent Requesting Restart')
        message = 'Sent Restart Request'
    else:
        send_retry_message(opponent_id, 'Game Restarting...')
        send_restart(game_id)
        message = 'Game Restarting...'
        
    return {
        'statusCode': 200,
        'body': json.dumps({'action': 'restartMessage', 'data': message})
    }

def send_retry_message(connection_id, message):
    payload = {'connection_id': connection_id, 'action': ACTION_NAME, 'data': message}
    lambda_client.invoke(
        FunctionName=LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
        
def send_restart(game_id):
    payload = {'gameId': game_id}
    lambda_client.invoke(
        FunctionName=RETRY_LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
