import { DatabaseData, SendingStatementsMessageFromServer } from "../../communication/Data.js";
import { Main } from "../../main/Main.js";
import { DatabaseTool, QueryResult } from "../../tools/database/DatabaseTool.js";
import { Module } from "../../compiler/parser/Module.js";
import { Klass } from "../../compiler/types/Class.js";
import { Method, Parameterlist } from "../../compiler/types/Types.js";
import { RuntimeObject } from "../../interpreter/RuntimeObject.js";
import { DatabaseLongPollingListener } from "src/client/tools/database/DatabaseLongPollingListener.js";

export class ConnectionClass extends Klass {

    constructor(module: Module) {
        super("Connection", module, "Ein Connection-Objekt repräsentiert die Verbindung zu einer Datenbank auf www.sql-ide.de");

        this.setBaseClass(<Klass>module.typeStore.getType("Object"));
        let preparedStatementType = <Klass>module.typeStore.getType("PreparedStatement");
        let statementType = <Klass>module.typeStore.getType("Statement");
 
        this.addMethod(new Method("createStatement", new Parameterlist([
        ]), statementType,
            (parameters) => {

                let o: RuntimeObject = parameters[0].value;
                let ch: ConnectionHelper = o.intrinsicData["Helper"];

                let stmt: RuntimeObject = new RuntimeObject(statementType);
                stmt.intrinsicData["ConnectionHelper"] = ch;
 
            }, false, false, 'Erstellt ein Statement-Objekt, mit dem Statements zur Datenbank geschickt werden können.',
            false));

    }

}


export class ConnectionHelper{

    database: DatabaseTool;
    databaseData: DatabaseData;
    token: string;
    longPollingListener: DatabaseLongPollingListener;

    constructor(private main: Main){

        main.getInterpreter().registerDatabaseConnection(this);

    }

    connect(code: string, callback: (error: string) => void ) {
        this.main.networkManager.fetchDatabaseAndToken(code, (dbData, token, error) => {
            if(error == null){
                this.token = token;
                this.databaseData = dbData;
                this.database = new DatabaseTool(this.main);
                this.database.initializeWorker(dbData.templateDump, dbData.statements, (error) => {
                    
                    this.longPollingListener = new DatabaseLongPollingListener(this.main.networkManager,
                        this.token, (firstNewStatementIndex, newStatements) => {
                            this.onServerSentStatements(firstNewStatementIndex, newStatements);
                        })
                    
                    this.longPollingListener.longPoll();
                    
                });
            } else {
                callback(error);
            }
        })
    }

    close(){
        if(this.longPollingListener != null){
            this.longPollingListener.close();
            this.longPollingListener = null;
        }
    }
 
    onServerSentStatements(firstNewStatementIndex: number, newStatements: string[]){

        this.executeStatementsFromServer(firstNewStatementIndex, newStatements);
        
    }
    
    executeStatementsFromServer(firstStatementIndex: number, statements: string[], 
        callback?: (error: string) => void){
        let currentDBVersion = this.databaseData.statements.length;
        let delta = currentDBVersion - firstStatementIndex + 1; // these statements are already there
        if(delta >= statements.length) return;
        statements = statements.slice(delta);
        this.database.executeWriteQueries(statements, () => {
            if(callback != null) callback(null);
        }, (errorMessage) => {
            if(callback != null) callback(errorMessage);
        })
    }

    executeWriteStatement(query: string, callback: (error: string) => void){

        let that = this;
        let oldStatementIndex = that.databaseData.statements.length;
        this.database.executeQuery("explain " + query, () => {

            that.main.networkManager.addDatabaseStatement(that.token, oldStatementIndex,
                [query], (statementsBefore, new_version, errorMessage)=>{
                    if(errorMessage != null){
                        callback(errorMessage);
                        return;
                    }

                    this.executeStatementsFromServer(oldStatementIndex + 1, statementsBefore.concat[query], callback);

                })

        }, (error) => {
            callback(error);
        })

    }

    executeQuery(query: string, callback: (error: string, data: QueryResult) => void){

        if(this.database == null || this.longPollingListener == null){
            callback("Es besteht keine Verbindung zur Datenbank.", null);
            return;
        }

        this.database.executeQuery(query, (results: QueryResult[]) => {
            callback(null, results[0]);
        }, (error: string) => { 
            callback(error, null);
        })

    }

}