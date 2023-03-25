import boto3
import json
import os


SUCCESS = "MatchmakingSucceeded"

CONNECT_LAMBDA = os.environ['CONNECT_PLAYERS_LAMBDA']


client = boto3.client('lambda')


def lambda_handler(event, context):
    message = json.loads(event['Records'][0]['Sns']['Message'])
    message_details = message['detail']
    message_type = message_details['type']

    if message_type == SUCCESS:
        game_session_info = message_details['gameSessionInfo']
        players = game_session_info['players']
        
        if len(players) != 2:
            print(players)
            raise RuntimeError(f'Expected 2 players but got {len(players)}')
        
        player1 = players[0]['playerId']
        player2 = players[1]['playerId']
        
        if player1 == player2:
            raise RuntimeError(f'Got matched with the same player: [{player1}]')
        
        payload = [player1, player2]
        
        client.invoke(FunctionName=CONNECT_LAMBDA,
                      InvocationType='Event',
                      Payload=json.dumps(payload).encode('utf-8'))
