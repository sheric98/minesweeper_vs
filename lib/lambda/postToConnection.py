import json
import boto3
import os


SOCKET_ENDPOINT = os.environ['SOCKET_ENDPOINT']
gateway = boto3.client('apigatewaymanagementapi', endpoint_url=SOCKET_ENDPOINT)


def lambda_handler(event, context):
    connection_id = event['connection_id']
    action = event['action']
    data = event['data']
    
    payload = {'action': action, 'data': data}
    
    gateway.post_to_connection(ConnectionId=connection_id, Data=json.dumps(payload))
