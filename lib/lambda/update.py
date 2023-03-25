import json
import boto3
import os


lambda_client = boto3.client('lambda')
LAMBDA_NAME = os.environ['POST_LAMBDA_NAME']

ACTION_NAME = "opponentUpdates"


def lambda_handler(event, context):
    body = json.loads(event['body'])
    message = json.loads(body['message'])
    opponent_id = message['opponentId']
    updates = message['updates']
    
    send_updates(opponent_id, updates)
    
    return {'statusCode': 200, 'body': ''}


def send_updates(opponent_id, updates):
    payload = {'connection_id': opponent_id, 'action': ACTION_NAME, 'data': updates}
    lambda_client.invoke(
        FunctionName=LAMBDA_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
