// Independent minimal XRecord client (NOT production code): shows when the server delivers.
#include <X11/Xlib.h>
#include <X11/extensions/record.h>
#include <stdio.h>
#include <time.h>
#include <stdlib.h>
static double now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000.0+t.tv_nsec/1e6;}
static double t0;
static void cb(XPointer c, XRecordInterceptData *d){
  if(d->category==XRecordFromServer) printf("t=%8.1fms type=%d keycode=%d\n",now()-t0,d->data[0]&0x7f,d->data[1]);
  XRecordFreeData(d);
}
int main(int argc,char**argv){
  Display*c=XOpenDisplay(0),*dd=XOpenDisplay(0);
  XRecordRange*r=XRecordAllocRange(); r->device_events.first=2; r->device_events.last=3;
  XRecordClientSpec cs=XRecordAllClients;
  XRecordContext ctx=XRecordCreateContext(c,0,&cs,1,&r,1); XSync(c,0);
  t0=now(); printf("go\n"); fflush(stdout);
  // blocking enable for 4 seconds from a timer thread is overkill: use async + select
  XRecordEnableContextAsync(dd,ctx,cb,0); XFlush(dd);
  int fd=ConnectionNumber(dd);
  while(now()-t0<atof(argv[1])*1000){ fd_set s;FD_ZERO(&s);FD_SET(fd,&s);struct timeval tv={0,50000};
    if(select(fd+1,&s,0,0,&tv)>0) XRecordProcessReplies(dd); fflush(stdout);}
  return 0;}
