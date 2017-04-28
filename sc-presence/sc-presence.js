
var scPresenceData = require('./sc-presence-data.js');
var scPresenceDbconn = require('./sc-presence-dbconn.js');

var config;
var activeUserThreshold;
var blockUsercountPublish = true;

//DEFAULT STARTUP CONFIG
module.exports.scPresenceConfig = {
    
    scpGcWorkerId			    : 0,
    scpGcInterval			    : 60, 
    scpGcThreshold			    : 120,
    scpBlockUsercountThreshold	: 60,
    scpSCPingsPerUpdate         : 6,  
    scpUsercountChannel		    : "USERCOUNT",
    scpUsercountType            : "USERS",
    scpPresenceChannel			: "_SCPRESENCE",
    scpDbhost					: "192.168.0.0",
    scpDbname					: "SCPresence",
    scpDbTablename				: "SCPresence_users",
    scpDbuser					: "SCP_user",
    scpDbpassword				: "besuretosetpasswordinworker",        
    scpConnectUpdateDelay		: 3000,
    scpUserIdField              : "user_id"
};

module.exports.scWorker;

module.exports.attach = function (worker, startupConfig, callback) {
    
    console.log("Presence System Starting with the following config:\r\n");

    //OVERWRITE DEFAULT CONFIG VALUES WITH WHATEVER WAS PASSED IN        
    for (var configItem in startupConfig) {
        module.exports.scPresenceConfig[configItem] = startupConfig[configItem];        
    }
    
    //INITIALIZE SOME VARIABLES
    config = module.exports.scPresenceConfig;
    scPresenceData.presenceConfig = config;
    console.log(config);    
    module.exports.worker = worker;

    //THIS DETERMINES HOW OFTEN A CLIENT SHOULD PING BASED ON THE CONFIG .
    //REPORTS WILL IGNORE CLIENTS WHO HAVEN'T PINGED IN THIS AMOUNT OF TIME.  THIS DOES NOT IMPACT GARBAGE COLLECTION.
    activeUserThreshold = parseInt((worker.scServer.pingInterval * config.scpSCPingsPerUpdate) / 1000);     
    
    
    //BLOCK PUBLISHING OF USERCOUNT STATISTICS FOR A SHORE PERIOD AFTER STARTUP TO ALLOW SOCKETS TO RECONNECT WITHOUT SPAMMING USERCOUNTS
    setTimeout(function () {
        blockUsercountPublish = false;
    }, config.scpBlockUsercountThreshold * 1000);
    

    //INITIALIZE THE PRESENCE SYSTEM            
    try {
        
        //CHECK FOR ANY INVALID CONFIGURATIONS AND ALERTS THE USER AS SUCH         
        if ((worker.scServer.pingInterval * config.scpSCPingsPerUpdate) / 1000 > config.scpGcThreshold) {
            var err = "\r\n Invalid presence configuration detected. GcThreshold must be greater than the SocketCluster " + 
                    "pingInterval multiplied by the scpSCPingsPerUpdate config of SCPresence." + 
                    " (required: (pingInterval x scpSCPingsPerUpdate)/1000 < scpGcThreshold)";

            console.log(err);

            if (typeof callback == "function") {
                callback(false, err);
            }
            return;
        }
        
        if (worker.options.workers < config.scpGcWorkerId+1) {
            var err = "\r\n Invalid scpGcWorkerId.  Not enough workers to start garbage collection on worker id " + config.scpGcWorkerId;
            
            console.log(err);
            
            if (typeof callback == "function") {
                callback(false, err);
            }
            return;
        }

            
            
        //SETUP THE DB CONNECTION POOL
        scPresenceDbconn.connect({
            host     : config.scpDbhost,
            user     : config.scpDbuser,
            password : config.scpDbpassword,
            database : config.scpDbname,
        });
        

        //WHEN A NEW SOCKET CONNECTS, INITIALIZE PRESENCE DATA AND EVENT HANDLERS FOR THAT SOCKET
        worker.scServer.on('connection', function (socket) {
            module.exports.connectSocket(socket);
            setTimeout(module.exports.publishUsercount, config.scpConnectUpdateDelay);
        });
        

        //STARTUP GARBAGE COLLECTION IF THIS IS THE PROPER WORKER ID
        if (worker.id == config.scpGcWorkerId) {

            setInterval(function () {
                scPresenceData.presenceGC(scPresenceDbconn.getClient(), config.scpGcThreshold);                    
            }, config.scpGcInterval * 1000);               
         
        }        

        //TRACK A SOCKET'S CHANNEL SUBSCRIPTION WHEN IT SUBSCRIBES TO A NEW CHANNEL
        worker.scServer.addMiddleware(worker.scServer.MIDDLEWARE_SUBSCRIBE, function (req, next) {
            module.exports.subscribeUser(req.socket, req.channel, function (err) { if (err) console.log(err); });
            next();
        });            
        

        console.log("\r\n Presence System Running.");
            
        if (typeof callback == "function") {
            callback(true, null);
        }

    } catch (ex) {
        console.log(ex);
        if (typeof callback == "function") {
            callback(false, ex);
        }
    }
}




//RUNS ON EACH SOCKET WHEN IT CONNECTS
module.exports.connectSocket = function (socket, callback) {        

    var pongCount = 0;
    
    //INITIALIZE SOCKET CONNECTION DATA
    scPresenceData.insertUserChannel(scPresenceDbconn.getClient(), socket, config.scpPresenceChannel);   
    
    
    //TIE INTO VARIOUS EVENTS TO HANDLE PRESENCE FUNCTIONALITY
    
    //SOCKET DISCONNECT    
    socket.on('disconnect', function () {
        module.exports.unsubscribeUser(socket, config.scpPresenceChannel, function (err) {
            if (err) {
                console.log(err);
            }

            module.exports.publishUsercount();
        });
    });    
       
    
    //SOCKET UNSUBSCRIBE CHANNEL FROM PRESENCE
    socket.on('unsubscribe', function (channel) {        
        module.exports.unsubscribeUser(socket, channel, function (err) { if (err) console.log(err); });        
    });           
    
    
    //TAP INTO SOCKETCLUSTER PING/PONG TO CREATE A PRESENCE HEARTBEAT
    socket.on('message', function (data) {        
        if (data == '2' || data == '#2') {           
            pongCount++;
            if (pongCount == config.scpSCPingsPerUpdate) {               
                pongCount = 0;
                module.exports.presencePing(socket);
            }
        }
    });


    //GET A FULL MAP OF CONNECTED USERS
    socket.on('userMap', function (callback) {
        module.exports.getUserMap(function (err, userMap) { 
            if (typeof callback == "function") {
                callback(err, userMap);
            }
        });
    });
}










///UPDATE PRESENCE INFORMATION FOR SOCKET////////////////////////////////
module.exports.presencePing = function (socket) {        
    var channels = '';
    
    for (channel in socket.channelSubscriptions) {        
        if (socket.channelSubscriptions[channel] == true) {
            channels += "," + channel
        }
    }
    
    channels = channels.substring(1, channels.length); 
    scPresenceData.updatePresencePing(scPresenceDbconn.getClient(), socket, config.scpPresenceChannel, channels);       
}
//////////////////////////////////////////////////////////////////////// 










/// INSERT A USER/CHANNEL INTO THE DB  //////////////////////////////////////////////////////////////////////////
module.exports.subscribeUser = function (socket, channel, callback) {   
    scPresenceData.insertUserChannel(scPresenceDbconn.getClient(), socket, channel, function (err, data) {
        if (typeof callback == "function") {
            if (!err || err == null) {   
                callback(null, data);
            } else {
                callback(err, null);
            }
        }
    });
}
////////////////////// END INSERT A USER/CHANNEL INTO THE DB  /////////////////////////////////////////////////////////////// 










/// REMOVE A USER/CHANNEL FROM THE DB ///////////////////////////////////////
module.exports.unsubscribeUser = function (socket, channel, callback) {          
    scPresenceData.removeUserChannel(scPresenceDbconn.getClient(), socket, channel, function (err, data) {
        if (typeof callback == "function") {
            if (!err || err == null) {   
                callback(null, data);
            } else {
                callback(err, null);
            }
        }
    });
}
////////////////////// END REMOVE A USER/CHANNEL  /////////////////////////////////////////////////////////////// 






//PUBLISH THE USERCOUNT TO THE DESIGNATED CHANNEL FOR USERCOUNT UPDATES
module.exports.publishUsercount = function (callback) {
    var userCount = 0;

    if (blockUsercountPublish == false) {
        if (config.scpUsercountType == "SUBSCRIPTIONS") {
            module.exports.getSubscriptioncount(function (err, count) {               
                if (count > 0) {
                    publishCount(count, callback);
                }
            });
        } else if (config.scpUsercountType == "SOCKETS") {
            module.exports.getSocketcount(function (err, count) {
                if (count > 0) {
                    publishCount(count, callback);
                }
            });
        } else if (config.scpUsercountType == "USERS") {
            module.exports.getUsercount(function (err, count) {
                if (count > 0) {
                    publishCount(count, callback);
                }
            });
        }      
    }
}


function publishCount(count, callback){
    module.exports.worker.scServer.global.publish(config.scpUsercountChannel, count);
    
    if (typeof callback === "function") {
        callback(err, userCount);
    }
}


//GET THE CURRENT USERCOUNT BASED ON THE NUMBER OF SOCKETS THAT ARE CONNECTED
module.exports.getSocketcount = function (callback) {
    scPresenceData.getSocketcount(scPresenceDbconn.getClient(), config.scpPresenceChannel, activeUserThreshold, function (err, data) {        
        if (!err || err == null) {
            if (data && data != null && typeof data != 'undefined' && data.length > 0) {                
                callback(null, data[0]["active_users"]);
            } else {                
                callback(err, null);
            }            
        } else {            
            callback(err, null);
        }
    });
}




//GET THE CURRENT USERCOUNT BASED ON THE NUMBER OF UNIQUE USERS THAT ARE CONNECTED BASED ON USER_ID FIELD IN AUTHTOKEN
module.exports.getUsercount = function (callback) {
    scPresenceData.getUsercount(scPresenceDbconn.getClient(), activeUserThreshold, function (err, data) {
        if (!err || err == null) {
            if (data && data != null && typeof data != 'undefined' && data.length > 0) {
                callback(null, data[0]["active_users"]);
            } else {
                callback(err, null);
            }
        } else {
            callback(err, null);
        }
    });
}




//GET THE CURRENT USERCOUNT BASED ON THE TOTAL NUMBER OF ACTIVE CHANNEL SUBSCRIPTIONS EXIST SYSTEM WIDE
module.exports.getSubscriptioncount = function (callback) {    
    scPresenceData.getSubscriptioncount(scPresenceDbconn.getClient(), activeUserThreshold, function (err, data) {        
        if (!err || err == null) {
            if (data && data != null && typeof data != 'undefined' && data.length > 0) {
                callback(null, data[0]["active_users"]);
            } else {
                callback(err, null);
            }
        } else {
            callback(err, null);
        }
    });
}






/// GET SYSTEM WIDE OBJECT SHOWING ALL ACTIVE USERS ///////////////////////////////////////
module.exports.getUserMap = function (callback) {    
    scPresenceData.getSocketData(scPresenceDbconn.getClient(), activeUserThreshold, function (err, socketData) {
        var userMap = createUserMap(socketData);
        if (!err || err == null) {   
            callback(null, userMap);
        } else {
            callback(err, null);
        }
    });   
}


function createUserMap(socketData) {    
    var userMap = {};
    var prevUserId;
    var prevSocketId;
    var subscribedChannels = [];
    var i = 0;

    while (i < socketData.length) {
       
        var socketRow = socketData[i];       
        var userId = socketRow.SCP_user_id;
        var socketId = socketRow.SCP_socket_id;        

        if (userId == null) {
            userId = 'null';
        }
        
        if (socketId == null) {
            socketId = 'null';
        }
        
        if (prevUserId != userId) {                        
            prevUserId = userId;
            userMap[userId] = {};            
        }
        
        //START OF DATA FOR A NEW SOCKET
        if (prevSocketId != socketId) {            
            prevSocketId = socketId;
            userMap[userId][socketId] = {};           
        }
        
        //SET THIS SOCKET'S PROPERTIES     
        userMap[userId][socketId].authToken = socketRow.SCP_authToken;
        userMap[userId][socketId].ip = socketRow.SCP_ip;
        userMap[userId][socketId].origin = socketRow.SCP_origin;
        userMap[userId][socketId].lastUpdate = socketRow.SCP_updated;              
        
        //GET FIRST CHANNEL SUBSCRIPTION FOR THIS CHANNEL
        if (socketRow.SCP_channel != config.scpPresenceChannel) {
            subscribedChannels.push(socketRow.SCP_channel);
        }        
        
        //GET ADDITIONAL CHANNEL SUBSCRTIPTIONS FOR THIS SOCKET
        var lookAheadCount = 1;
        var nextSocketId = socketId;
        while (nextSocketId == socketId) {
            var nextSocketRow = socketData[i + lookAheadCount];
            if (typeof nextSocketRow == "object") {
                nextSocketId = nextSocketRow.SCP_socket_id;
                if (nextSocketId == socketId && nextSocketRow.SCP_channel != config.scpPresenceChannel) {
                    subscribedChannels.push(nextSocketRow.SCP_channel);
                    lookAheadCount++;
                }
            } else {
                break;
            }
        }             
                
        userMap[userId][prevSocketId].subscribedChannels = subscribedChannels;
        subscribedChannels = [];
        i = i+lookAheadCount;                            
    }    
}
////////////////////// END GET ACTIVE USER INFO FROM DB  ////////////////////////////////// 
        