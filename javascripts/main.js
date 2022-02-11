if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
 // some code..
} else {
  $('#projects-terminal').sticky({
    context: '#projects',
    offset:  80
  });
}


$('#navigation a').click(function(){
  $('#projects-terminal').sticky('refresh');
})


