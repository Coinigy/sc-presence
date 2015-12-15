# sc-presence
#### Socket Presence Module for SocketCluster

## Features
**Track active users in your SocketCluster based application**
**Store all active socket data and channel subscriptions across multiple workers or hosts**
**Built-in garbage collection prunes abandoned or inactive records**
**Simple to install and use.  Requires only a MySQL db and a single line of code.**
**Publishes a user count update whenever someone joins or leaves**
**Works with or without authenticated users**


## Install

##### Create Database

```sql
CREATE DATABASE IF NOT EXISTS `SCPresence`;
USE SCPresence;

DROP USER 'SCP_user'@'localhost';
FLUSH PRIVILEGES;
CREATE USER 'SCP_user'@'localhost' IDENTIFIED BY 'putyourpasswordhere';
GRANT SELECT ON `SCPresence`.* TO 'SCP_user'@'localhost'; 
GRANT INSERT ON `SCPresence`.* TO 'SCP_user'@'localhost'; 
GRANT UPDATE ON `SCPresence`.* TO 'SCP_user'@'localhost'; 
GRANT DELETE ON `SCPresence`.* TO 'SCP_user'@'localhost'; 
GRANT EXECUTE ON `SCPresence`.* TO 'SCP_user'@'localhost'; 


CREATE TABLE IF NOT EXISTS `SCPresence_users` (
  SCP_id INT(11) NOT NULL AUTO_INCREMENT,
  SCP_socket_id VARCHAR(255) DEFAULT NULL,
  SCP_user_id INT(11) DEFAULT NULL,
  SCP_channel VARCHAR(255) DEFAULT NULL,
  SCP_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  SCP_authToken VARCHAR(2048) DEFAULT NULL,  
  SCP_ip VARCHAR(255) DEFAULT NULL,
  SCP_origin VARCHAR(1024) DEFAULT NULL,
  PRIMARY KEY (SCP_id),
  UNIQUE INDEX IX_unique_user_channel_socket (SCP_user_id, SCP_channel, SCP_socket_id)
)
ENGINE = INNODB;
```

##### Install NPM Package
```
npm install sc-presence
```

##### Attach sc-presence to your workers
```javascript
module.exports.run = function (worker) {
    require('sc-presence').attach(worker, options);
};
```


## Options 
 Only scpDbhost and scpDbpassword are required

**scpGcWorkerId**<br/>
The worker id of the worker that will handle sc-presence garbage collection duties<br/>
Default Value: **0**<br/>

**scpGcInterval**<br/>
The interval in number of seconds on which the garbage collection process will run<br/>
Default Value: **60**<br/>

**scpGcThreshold**<br/>
The number of seconds that must pass without an update before the garbage collection process will remove a record<br/>
Default Value: **120**<br/>

**scpBlockUsercountThreshold**<br/>
The number of seconds sc-presence will wait after startup before starting to publish user count updates.
This prevents sc-presence from spamming user count updates when the system is restarted and sockets are reconnecting.<br/>
Default Value: **60**<br/>

**scpSCPingsPerUpdate**<br/>
The number of scServer.pingInterval periods that must pass before sc-presence will fire a database update<br/>
Default Value: **6**  <br/>

**scpUsercountChannel** <br/>
The name of the channel on which sc-presence will publish user count updates<br/>
Default Value: **"USERCOUNT"**<br/>

**scpUsercountType**<br/> 
The type of user count update sc-presence will publish when a user joins or leaves<br/>
Possible values are: "SUBSCRIPTIONS", "SOCKETS", "USERS"<br/>
Default Value: **"USERS"**<br/>

**scpPresenceChannel**<br/>
The name of the channel that sc-presence will register primary socket presence under<br/>
Default Value: **"_SCPRESENCE"**<br/>

**scpDbhost**<br/>
The host name of the sc-presence db<br/>
Default Value: **None**<br/>

**scpDbname**<br/>
The name of the sc-presence db<br/>
Default Value: **"SCPresence"**<br/>

**scpDbTablename**<br/>
The name of the db table where sc-presence data is stored<br/>
Default Value: **"SCPresence_users"**<br/>

**scpDbuser**<br/>
The name of the db user that will authenticate to the sc-presence db<br/>
Default Value: **"SCP_user"**<br/>

**scpDbpassword**<br/>
The password for the db user that will authenticate to the sc-presence db<br/>
Default Value: **None**<br/>
      
**scpConnectUpdateDelay**<br/>
When a new socket connects, sc-presence will wait this many ms before publishing a user count update. This ensures the socket that connected has time to subscribe to the scpUsercountChannel channel before the user count is published<br/>
Default Value: **3000**<br/>

**scpUserIdField**<br/>
The name of the property in the authToken which will be stored in the SCP_user_id field in the database<br/>
(numeric or string values are ok) <br/>
Default Value: **"user_id"**<br/>

##### Example
```
{
    
    scpGcWorkerId			    : 0,
    scpGcInterval			    : 60, 
    scpGcThreshold			    : 120,
    scpBlockUsercountThreshold	: 60,
    scpSCPingsPerUpdate         : 6,  
    scpUsercountChannel		    : "USERCOUNT",
    scpUsercountType            : "USERS",
    scpPresenceChannel			: "_SCPRESENCE",
    scpDbhost					: "dbHostname",
    scpDbname					: "SCPresence",
    scpDbTablename				: "SCPresence_users",
    scpDbuser					: "SCP_user",
    scpDbpassword				: "besuretosetpassword",        
    scpConnectUpdateDelay		: 3000,
    scpUserIdField              : "user_id"
}
```
