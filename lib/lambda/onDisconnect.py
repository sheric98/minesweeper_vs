import boto3
import os

TABLE_NAME = os.environ['CONNECTIONS_TABLE_NAME']
SESSION_NAME = os.environ['SESSIONS_TABLE_NAME']


resource = boto3.resource('dynamodb')
table = resource.Table(TABLE_NAME)
sessions = resource.Table(SESSION_NAME)
gamelift = boto3.client('gamelift')


def lambda_handler(event, context):
    connection_id = event['requestContext']['connectionId']
    
    ret = table.delete_item(Key={'connectionId': connection_id}, ReturnValues='ALL_OLD')
    item = ret['Attributes']
    
    if 'gameId' in item:
        game_id = item['gameId']
        game_key = {'sessionId': game_id}
        game_ret = sessions.update_item(
            Key=game_key,
            ReturnValues='ALL_NEW',
            UpdateExpression='ADD numPlayers :val',
            ExpressionAttributeValues={':val': -1})
        new_game_item = game_ret['Attributes']
        if new_game_item['numPlayers'] == 0:
            sessions.delete_item(Key=game_key)
    
    if 'ticketId' in item:
        ticket_id = item['ticketId']
        gamelift.stop_matchmaking(TicketId=ticket_id)
        