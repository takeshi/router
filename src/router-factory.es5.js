angular.module('ngNewRouter')
.factory('$$rootRouter', ['$$grammar','$$pipeline','$q',
  function ($$grammar, $$pipeline,$q) {
    if(!window.$q){
      window.$q = $q;
    }
    return new RootRouter($$grammar,$$pipeline);
  }]
);

angular.module('ngNewRouter')
.factory('$$grammar',['$q',function($q){
    if(!window.$q){
      window.$q = $q;
    }
    return new Grammar();
  }]
);
