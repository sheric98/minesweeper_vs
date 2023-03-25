import json
import boto3
import os


CONNECTION_TABLE_NAME = os.environ['CONNECTIONS_TABLE_NAME']
MINESWEEPER_CONFIG = os.environ['MINESWEEPER_CONFIG_NAME']


table = boto3.resource('dynamodb').Table(CONNECTION_TABLE_NAME)
gamelift = boto3.client('gamelift')

def lambda_handler(event, context):
    connection_id = event['requestContext']['connectionId']
    
    try:
        res = gamelift.start_matchmaking(ConfigurationName=MINESWEEPER_CONFIG, Players=[{'PlayerId': connection_id}])
        ticket_id = res['MatchmakingTicket']['TicketId']
        table.put_item(Item={'connectionId': connection_id, 'ticketId': ticket_id})
        return {
            "statusCode": 200,
            "body": json.dumps('Put connection')
        }
    except Exception as e:
        print(e)
        return {
            "statusCode": 500,
            "body": json.dumps('Error putting connection in table')
        }
