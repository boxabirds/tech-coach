create table users(id text primary key);
create table sessions(id text primary key, user_id text not null);
