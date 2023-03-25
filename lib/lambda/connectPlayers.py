import json
import boto3
import uuid
from boto3.dynamodb.conditions import Attr
import os


CONNECTIONS_TABLE = os.environ['CONNECTIONS_TABLE_NAME']
SESSIONS_TABLE = os.environ['SESSIONS_TABLE_NAME']


client = boto3.resource('dynamodb')
connections = client.Table(CONNECTIONS_TABLE)
sessions = client.Table(SESSIONS_TABLE)

lambda_client = boto3.client('lambda')
POST_FUNCTION_NAME = os.environ['POST_LAMBDA_NAME']

ACTION_NAME = 'connect'


def lambda_handler(event, context):
    player_one, player_two = event
    session_id = str(uuid.uuid4())
    session_item = {
        'sessionId': session_id,
        'playerOne': player_one,
        'playerTwo': player_two,
        'numPlayers': 2
    }
    
    sessions.put_item(Item=session_item)
    
    try:
        put_item_exists(player_one, session_id)
    except:
        revert_session(session_id)
        return
        
    try:
        put_item_exists(player_two, session_id)
    except:
        revert_session(session_id)
        connections.put_item(Item={"connectionId": player_one})
        return
    
    post_connect(player_one, 0, session_id, player_two)
    post_connect(player_two, 1, session_id, player_one)

        
def make_player_item(player_id, session_id):
    return {
        "connectionId": player_id,
        "gameId": session_id
    }

def put_item_exists(player_id, session_id):
    item = make_player_item(player_id, session_id)
    connections.put_item(
        Item=item,
        ConditionExpression="attribute_exists(#r)",
        ExpressionAttributeNames={"#r": "connectionId"}
    )

def revert_session(session_id):
    sessions.delete_item(Key={'sessionId': session_id})

def post_connect(connection_id, player_id, session_id, other_player):
    data = {'gameId': session_id, 'opponentId': other_player, 'playerNum': player_id}
    payload = {'connection_id': connection_id, 'action': ACTION_NAME, 'data': data}
    lambda_client.invoke(
        FunctionName=POST_FUNCTION_NAME,
        InvocationType='Event',
        Payload=json.dumps(payload).encode('utf-8'))
